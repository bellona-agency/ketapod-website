package catalog

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"ketapod/internal/catalog/sqlcgen"
)

// DBTX is whatever can run a query — a pool or an open transaction.
//
// It is exported so another module can hand this package *its*
// transaction. That is the point of this file: the rule in
// 04-architecture.md is that a module is the only writer of its own
// tables, but the admin ingest panel has to create the catalogue row,
// the AI service's row and the dispatch job in one commit. Passing the
// transaction in keeps both true — the SQL for catalog.* lives in
// catalog, and the caller still gets atomicity.
type DBTX = sqlcgen.DBTX

// NewBook is the narrow set of fields the ingest panel can supply. It is
// deliberately not the full Book: price, editions, categories and rights
// terms are editorial decisions that do not belong to whoever uploaded a
// PDF.
type NewBook struct {
	Title          string
	AuthorName     string
	Description    string
	CoverURL       string
	Language       string
	IsKidsFriendly bool
	// Status is the catalogue status the row starts in. The panel uses
	// "published" because an uploaded book is meant to appear in the
	// site's list immediately, even before any audio edition exists.
	Status string
}

// CreateBookInTx inserts a book (and its author, if named) using the
// caller's transaction, and returns the new book id and slug.
//
// A rights grant is written too: HasActiveRights defaults to "we do not
// have the rights", so without one the book is invisible to every
// licence check in the system and nothing downstream can use it. The
// grant records where it came from — an internal upload — rather than
// implying a contract that does not exist.
func CreateBookInTx(ctx context.Context, db DBTX, in NewBook) (bookID string, slug string, err error) {
	q := sqlcgen.New(db)

	if in.Language == "" {
		in.Language = "fa"
	}
	if in.Status == "" {
		in.Status = "published"
	}

	var authorID pgtype.UUID
	if name := strings.TrimSpace(in.AuthorName); name != "" {
		author, err := q.UpsertAuthorByName(ctx, sqlcgen.UpsertAuthorByNameParams{
			Name: name,
			Slug: Slugify(name),
		})
		if err != nil {
			return "", "", fmt.Errorf("catalog: upsert author: %w", err)
		}
		authorID = pgtype.UUID{Bytes: author.ID, Valid: true}
	}

	base := Slugify(in.Title)
	if base == "" {
		base = "book"
	}

	// Slug collisions are normal, not exceptional: two uploads of the
	// same title are a thing an editor does on purpose. Retry with a
	// short suffix rather than failing the upload.
	for attempt := 0; attempt < 6; attempt++ {
		candidate := base
		if attempt > 0 {
			candidate = base + "-" + randomSuffix()
		}

		id, err := q.CreateBookIfSlugFree(ctx, sqlcgen.CreateBookIfSlugFreeParams{
			Slug:           candidate,
			Title:          in.Title,
			AuthorID:       authorID,
			Description:    optional(in.Description),
			CoverUrl:       optional(in.CoverURL),
			Language:       in.Language,
			IsKidsFriendly: in.IsKidsFriendly,
			Status:         in.Status,
		})
		if err != nil {
			// ON CONFLICT DO NOTHING returns no rows, which sqlc
			// surfaces as pgx.ErrNoRows on a :one query. That is the
			// collision case, not a failure.
			if isNoRows(err) {
				continue
			}
			return "", "", fmt.Errorf("catalog: create book: %w", err)
		}

		if err := q.EnsureIngestRightsGrant(ctx, id); err != nil {
			return "", "", fmt.Errorf("catalog: ensure rights grant: %w", err)
		}
		return id.String(), candidate, nil
	}

	return "", "", fmt.Errorf("catalog: could not find a free slug for %q", in.Title)
}

// SetBookCoverURL updates a cover after the fact. The ingest panel needs
// it because the cover URL contains the submission id, which does not
// exist until the submission row is written.
func SetBookCoverURL(ctx context.Context, db DBTX, bookID, coverURL string) error {
	id, err := uuid.Parse(bookID)
	if err != nil {
		return fmt.Errorf("catalog: parse book id: %w", err)
	}
	return sqlcgen.New(db).SetBookCoverURL(ctx, sqlcgen.SetBookCoverURLParams{
		ID:       id,
		CoverUrl: optional(coverURL),
	})
}

// Slugify keeps Persian letters instead of transliterating them. A slug
// is a URL segment, and a percent-encoded Persian segment is valid,
// linkable and readable in the address bar — while transliteration would
// need a mapping table that gets "خ" wrong in a different way every time.
func Slugify(s string) string {
	var b strings.Builder
	lastDash := true // leading dashes are dropped

	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			lastDash = false
		case r == '‌': // نیم‌فاصله: a word separator, not a letter
			fallthrough
		case unicode.IsSpace(r), r == '-', r == '_', r == '.', r == '/':
			if !lastDash {
				b.WriteRune('-')
				lastDash = true
			}
		}
	}

	return strings.Trim(b.String(), "-")
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

func randomSuffix() string {
	var buf [3]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "x"
	}
	return hex.EncodeToString(buf[:])
}

func optional(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

// NarratedEdition is one AI-narrated edition of a book, as the ingest
// panel materialises it after TTS.
type NarratedEdition struct {
	BookID          string
	VoiceID         string
	VoiceName       string
	VoiceStyle      string
	Language        string
	IsKidsFriendly  bool
	PriceIRR        int64
	PreviewSeconds  int
	DurationSeconds int
	// Chapters are time ranges on the edition's single audio file, not
	// files of their own — that is the shape catalog.chapters has, and
	// the player draws its chapter bar from it. The existing Chapter
	// type from model.go is reused; ID and SortOrder are assigned here.
	Chapters []Chapter
}

// UpsertNarratedEditionInTx creates (or refreshes) the AI edition of a
// book together with its chapters, and returns the edition id.
//
// Chapters are replaced wholesale rather than merged. A re-narration
// changes every boundary at once — merging would leave the tail of a
// previous, longer version pointing past the end of the new audio.
func UpsertNarratedEditionInTx(ctx context.Context, db DBTX, in NarratedEdition) (string, error) {
	q := sqlcgen.New(db)

	bookID, err := uuid.Parse(in.BookID)
	if err != nil {
		return "", fmt.Errorf("catalog: parse book id: %w", err)
	}

	if in.Language == "" {
		in.Language = "fa"
	}
	if in.VoiceName == "" {
		in.VoiceName = "گوینده هوش مصنوعی"
	}
	if in.VoiceStyle == "" {
		in.VoiceStyle = "calm"
	}

	// The voice row has to exist before the edition can reference it:
	// audio_editions.voice_id is a foreign key, and a database that was
	// never seeded has no voices at all.
	if _, err := q.UpsertVoice(ctx, sqlcgen.UpsertVoiceParams{
		ID: in.VoiceID, Name: in.VoiceName, Style: in.VoiceStyle,
	}); err != nil {
		return "", fmt.Errorf("catalog: upsert voice: %w", err)
	}

	editionID, err := q.UpsertAIEdition(ctx, sqlcgen.UpsertAIEditionParams{
		BookID:          bookID,
		VoiceID:         in.VoiceID,
		Language:        in.Language,
		IsKidsFriendly:  in.IsKidsFriendly,
		PriceIrr:        in.PriceIRR,
		PreviewSeconds:  int32(in.PreviewSeconds),
		DurationSeconds: int32(in.DurationSeconds),
	})
	if err != nil {
		return "", fmt.Errorf("catalog: upsert edition: %w", err)
	}

	if err := q.DeleteChaptersForEdition(ctx, editionID); err != nil {
		return "", fmt.Errorf("catalog: clear chapters: %w", err)
	}
	for i, chapter := range in.Chapters {
		if err := q.CreateChapter(ctx, sqlcgen.CreateChapterParams{
			AudioEditionID: editionID,
			Title:          chapter.Title,
			SortOrder:      int32(i),
			StartSeconds:   numeric(chapter.StartSeconds),
			EndSeconds:     numeric(chapter.EndSeconds),
		}); err != nil {
			return "", fmt.Errorf("catalog: create chapter: %w", err)
		}
	}

	return editionID.String(), nil
}

// SetBookDescriptionIfEmptyInTx fills in a description the AI service
// produced, without ever overwriting one a human wrote. An editor's copy
// outranks a generated summary; a generated summary outranks nothing.
func SetBookDescriptionIfEmptyInTx(ctx context.Context, db DBTX, bookID, description string) error {
	id, err := uuid.Parse(bookID)
	if err != nil {
		return fmt.Errorf("catalog: parse book id: %w", err)
	}
	return sqlcgen.New(db).SetBookDescriptionIfEmpty(ctx, sqlcgen.SetBookDescriptionIfEmptyParams{
		ID:          id,
		Description: &description,
	})
}

// numeric turns seconds into the exact-decimal type catalog.chapters
// uses. Chapter boundaries are compared against playback position, so a
// float that drifts by a millisecond puts the player one chapter off at
// the seam.
func numeric(seconds float64) pgtype.Numeric {
	var n pgtype.Numeric
	if err := n.Scan(strconv.FormatFloat(seconds, 'f', 3, 64)); err != nil {
		return pgtype.Numeric{Valid: false}
	}
	return n
}
