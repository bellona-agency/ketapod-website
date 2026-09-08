package integrationtest

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"ketapod/internal/catalog"
)

func newCatalogService(t *testing.T) (*catalog.Service, *fixtures) {
	t.Helper()
	pool := newPool(t)
	return catalog.NewService(catalog.NewRepository(pool)), newFixtures(t, pool)
}

// Persian search is where a plausible-looking implementation quietly
// fails. The same word typed on three keyboards is three different byte
// sequences, and a user who searches for a book we have and gets nothing
// concludes we do not have it.
//
// The fold lives in SQL (catalog.normalize_fa) so the *index* and the
// *query* agree; normalizing only the query would leave the index full
// of unfolded text and change nothing.
func TestPersianSearchFoldsCharacterVariants(t *testing.T) {
	svc, f := newCatalogService(t)
	ctx := context.Background()

	f.book(bookOpts{Slug: "ghesse-ye-shab", Title: "قصه شب", AuthorName: "زهرا طاهری"})
	f.book(bookOpts{Slug: "ghesse-haye-kootah", Title: "قصه‌های کوتاه"})
	f.book(bookOpts{Slug: "modiriyat", Title: "مدیریت زمان",
		Description: "کتابی درباره برنامه‌ریزی و بهره‌وری"})
	f.book(bookOpts{Slug: "bedtime", Title: "Bedtime Stories"})

	tests := []struct {
		name       string
		query      string
		wantTitles []string
	}{
		{
			name:  "a bare word matches both the standalone and the compound form",
			query: "قصه",
			// "قصه‌های" contains a zero-width non-joiner. Without folding
			// it on the indexing side this returns only the first title.
			wantTitles: []string{"قصه شب", "قصه‌های کوتاه"},
		},
		{
			name:       "Arabic yeh matches Persian yeh",
			query:      "مديريت", // Arabic yeh
			wantTitles: []string{"مدیریت زمان"},
		},
		{
			name:       "a compound typed with a space matches the ZWNJ spelling",
			query:      "قصه های",
			wantTitles: []string{"قصه‌های کوتاه", "قصه شب"},
		},
		{
			name:       "the description is searchable, not just the title",
			query:      "بهره‌وری",
			wantTitles: []string{"مدیریت زمان"},
		},
		{
			name:       "the author's name is searchable",
			query:      "طاهری",
			wantTitles: []string{"قصه شب"},
		},
		{
			name:       "latin titles still work",
			query:      "Bedtime",
			wantTitles: []string{"Bedtime Stories"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			books, total, err := svc.Search(ctx, tc.query, nil, 20, 0)
			require.NoError(t, err)
			require.Equal(t, int64(len(tc.wantTitles)), total, "unexpected result count for %q", tc.query)

			got := make([]string, len(books))
			for i, b := range books {
				got[i] = b.Title
			}
			require.ElementsMatch(t, tc.wantTitles, got)
		})
	}

	t.Run("a one-character query is refused rather than scanning everything", func(t *testing.T) {
		_, _, err := svc.Search(ctx, "ق", nil, 20, 0)
		require.ErrorIs(t, err, catalog.ErrQueryTooShort)
	})

	t.Run("search can be limited to kids content", func(t *testing.T) {
		f.book(bookOpts{Slug: "kids-tale", Title: "قصه کودکانه", IsKidsFriendly: true})

		kidsOnly := true
		books, _, err := svc.Search(ctx, "قصه", &kidsOnly, 20, 0)
		require.NoError(t, err)
		require.Len(t, books, 1)
		require.Equal(t, "قصه کودکانه", books[0].Title)
	})
}

func TestListBooksFiltersAndPaginates(t *testing.T) {
	svc, f := newCatalogService(t)
	ctx := context.Background()

	for _, spec := range []bookOpts{
		{Slug: "a", Title: "الف", AuthorName: "نویسنده یک"},
		{Slug: "b", Title: "ب", AuthorName: "نویسنده دو"},
		{Slug: "c", Title: "پ", IsKidsFriendly: true},
	} {
		f.book(spec)
	}

	all, total, err := svc.ListBooks(ctx, catalog.BookFilter{Limit: 20})
	require.NoError(t, err)
	require.Equal(t, int64(3), total)
	require.Len(t, all, 3)

	t.Run("kids filter", func(t *testing.T) {
		kidsOnly := true
		books, total, err := svc.ListBooks(ctx, catalog.BookFilter{KidsOnly: &kidsOnly, Limit: 20})
		require.NoError(t, err)
		require.Equal(t, int64(1), total)
		require.Equal(t, "پ", books[0].Title)
	})

	t.Run("author filter", func(t *testing.T) {
		slug := "author-a"
		books, total, err := svc.ListBooks(ctx, catalog.BookFilter{AuthorSlug: &slug, Limit: 20})
		require.NoError(t, err)
		require.Equal(t, int64(1), total)
		require.Equal(t, "الف", books[0].Title)
	})

	t.Run("the total reflects the whole result set, not the page", func(t *testing.T) {
		// A bare array would leave the client unable to tell whether
		// more pages exist, and adding the envelope later is a breaking
		// change across three generated clients.
		page, total, err := svc.ListBooks(ctx, catalog.BookFilter{Limit: 2})
		require.NoError(t, err)
		require.Len(t, page, 2)
		require.Equal(t, int64(3), total)
	})
}

func TestGetBookAndEditions(t *testing.T) {
	svc, f := newCatalogService(t)
	ctx := context.Background()

	bookID := f.book(bookOpts{Slug: "detail-book", Title: "جزئیات", AuthorName: "نویسنده نمونه"})
	f.edition(editionOpts{BookID: bookID, VoiceID: "calm", PriceIRR: 300_000, PreviewSeconds: 60, DurationSeconds: 900, WithAsset: true})
	f.edition(editionOpts{BookID: bookID, VoiceID: "kids", PriceIRR: 0, IsKidsFriendly: true, WithAsset: true})

	book, err := svc.GetBookBySlug(ctx, "detail-book")
	require.NoError(t, err)
	require.Equal(t, "جزئیات", book.Title)
	require.Equal(t, "نویسنده نمونه", book.AuthorName)

	editions, err := svc.ListEditionsForBook(ctx, book.ID)
	require.NoError(t, err)
	require.Len(t, editions, 2, "one work, several performances")

	byVoice := map[string]catalog.Edition{}
	for _, e := range editions {
		byVoice[e.VoiceID] = e
	}
	require.Equal(t, int64(300_000), byVoice["calm"].PriceIRR)
	require.True(t, byVoice["kids"].IsFree(), "editions are priced independently")

	t.Run("a draft edition is not listed publicly", func(t *testing.T) {
		f.edition(editionOpts{BookID: bookID, VoiceID: "draft-voice", Status: "draft", WithAsset: true})
		published, err := svc.ListEditionsForBook(ctx, book.ID)
		require.NoError(t, err)
		require.Len(t, published, 2)
	})

	t.Run("an unknown slug is a not-found, not an empty book", func(t *testing.T) {
		_, err := svc.GetBookBySlug(ctx, "does-not-exist")
		require.ErrorIs(t, err, catalog.ErrNotFound)
	})
}

// The synced transcript is the one asset with four uses: accessibility,
// SEO, word-level highlighting, and Ketabyar's RAG context. Every
// consumer wants a *window*, not the whole book.
func TestTranscriptWindow(t *testing.T) {
	svc, f := newCatalogService(t)
	ctx := context.Background()

	bookID := f.book(bookOpts{Slug: "transcribed", Title: "ترنسکریپت‌دار"})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", DurationSeconds: 600, WithAsset: true})

	require.NoError(t, svc.SaveTranscript(ctx, editionID, "fa", []catalog.TranscriptSegment{
		{Text: "جمله اول", StartSeconds: 0, EndSeconds: 5},
		{Text: "جمله دوم", StartSeconds: 5, EndSeconds: 10},
		{Text: "جمله سوم", StartSeconds: 100, EndSeconds: 105},
		{Text: "جمله چهارم", StartSeconds: 500, EndSeconds: 505},
	}))

	t.Run("returns only the segments overlapping the window", func(t *testing.T) {
		segments, err := svc.TranscriptWindow(ctx, editionID, 0, 20)
		require.NoError(t, err)
		require.Len(t, segments, 2)
		require.Equal(t, "جمله اول", segments[0].Text)
	})

	t.Run("a window around a position picks up its neighbours", func(t *testing.T) {
		segments, err := svc.TranscriptWindow(ctx, editionID, 95, 110)
		require.NoError(t, err)
		require.Len(t, segments, 1)
		require.Equal(t, "جمله سوم", segments[0].Text)
	})

	t.Run("a reversed window is normalized rather than returning nothing", func(t *testing.T) {
		segments, err := svc.TranscriptWindow(ctx, editionID, 110, 95)
		require.NoError(t, err)
		require.Len(t, segments, 1)
	})

	t.Run("saving again replaces rather than appending", func(t *testing.T) {
		require.NoError(t, svc.SaveTranscript(ctx, editionID, "fa", []catalog.TranscriptSegment{
			{Text: "بازنویسی", StartSeconds: 0, EndSeconds: 3},
		}))
		segments, err := svc.TranscriptWindow(ctx, editionID, 0, 600)
		require.NoError(t, err)
		require.Len(t, segments, 1)
	})
}

// "Do we have the rights to distribute this?" defaults to no. Publishers
// refusing to license is an existential risk (02-business.md), so the
// safe answer is the default rather than the convenient one.
func TestRightsDefaultToNotGranted(t *testing.T) {
	svc, f := newCatalogService(t)
	ctx := context.Background()

	bookID := f.book(bookOpts{Slug: "unlicensed", Title: "بدون قرارداد"})

	has, err := svc.HasActiveRights(ctx, bookID)
	require.NoError(t, err)
	require.False(t, has, "no grant on record means no rights")

	_, err = f.pool.Exec(ctx, `
		INSERT INTO catalog.rights_grants (book_id, scope, revenue_share_percent, contract_ref)
		VALUES ($1, 'audio_distribution', 30, 'CONTRACT-1')`, bookID)
	require.NoError(t, err)

	has, err = svc.HasActiveRights(ctx, bookID)
	require.NoError(t, err)
	require.True(t, has)

	t.Run("an expired grant does not count", func(t *testing.T) {
		_, err := f.pool.Exec(ctx,
			`UPDATE catalog.rights_grants SET expires_at = now() - interval '1 day' WHERE book_id = $1`, bookID)
		require.NoError(t, err)

		has, err := svc.HasActiveRights(ctx, bookID)
		require.NoError(t, err)
		require.False(t, has)
	})
}

// The pronunciation lexicon is the accumulating asset: every book
// improves the next one. A book-specific reading must win over the
// global one, because the same grapheme genuinely differs between works.
func TestLexiconBookEntriesOverrideGlobalOnes(t *testing.T) {
	svc, f := newCatalogService(t)
	ctx := context.Background()

	bookID := f.book(bookOpts{Slug: "lexicon-book", Title: "واژه‌نامه"})
	otherID := f.book(bookOpts{Slug: "other-book", Title: "کتاب دیگر"})

	_, err := f.pool.Exec(ctx, `
		INSERT INTO catalog.pronunciation_lexicon (book_id, grapheme, phoneme, language)
		VALUES (NULL, 'کرم', 'kerm', 'fa'), ($1, 'کرم', 'karam', 'fa')`, bookID)
	require.NoError(t, err)

	forBook, err := svc.ResolveLexicon(ctx, bookID, "fa")
	require.NoError(t, err)
	require.Equal(t, "karam", forBook["کرم"], "the book-specific reading wins")

	forOther, err := svc.ResolveLexicon(ctx, otherID, "fa")
	require.NoError(t, err)
	require.Equal(t, "kerm", forOther["کرم"], "another book falls back to the global reading")
}
