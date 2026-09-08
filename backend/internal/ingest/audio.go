package ingest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"ketapod/internal/catalog"
	"ketapod/internal/media"
)

// ErrNoAudioYet means the AI service has not produced anything for this
// book yet. It is the normal state between "dispatched" and "narrated",
// not a failure, so the sweep leaves the submission alone rather than
// marking it broken.
var ErrNoAudioYet = errors.New("ingest: no audio produced yet")

// AudioConfig decides how a narration lands in the catalogue.
//
// The voice id matters more than it looks: the design contract is
// voices[].id == sources[].voiceId across the whole system, so the
// narration produced here has to claim a voice the rest of the product
// can name. It is configuration because "which voice was this" is
// eventually a per-book choice, and hardcoding it now would make that a
// migration later.
type AudioConfig struct {
	VoiceID    string
	VoiceName  string
	VoiceStyle string
	// PriceIRR is what a narrated edition costs. Zero — free — is the
	// deliberate default: books uploaded through the internal panel are
	// test and seed content, and a price set by accident is a book
	// nobody can hear.
	PriceIRR       int64
	PreviewSeconds int
	// FFmpegPath concatenates per-chapter files into the single
	// continuous file the player expects. Empty means "look for ffmpeg
	// on PATH".
	FFmpegPath string
}

func (c AudioConfig) withDefaults() AudioConfig {
	if c.VoiceID == "" {
		c.VoiceID = "voice_narrator_fa_ai"
	}
	if c.VoiceName == "" {
		c.VoiceName = "گوینده هوش مصنوعی"
	}
	if c.VoiceStyle == "" {
		c.VoiceStyle = "calm"
	}
	if c.PreviewSeconds == 0 {
		c.PreviewSeconds = 60
	}
	if c.FFmpegPath == "" {
		c.FFmpegPath = "ffmpeg"
	}
	return c
}

// aiAudioPart is one file the AI service produced.
type aiAudioPart struct {
	StorageKey   string
	Format       string
	Duration     float64
	Status       string
	ChapterTitle string
}

// SyncAudio turns the AI service's TTS output into a playable edition.
//
// The two sides model audio differently and this is where that gap is
// closed. The AI service writes one file per chapter (or one for the
// whole book) into public.audio_assets. Our catalogue has one edition
// with one continuous file, and chapters as time ranges on it — that is
// what the player, the listening position, the bookmark and the
// transcript all address. So: one file passes through untouched, several
// files are concatenated in order and the chapter boundaries fall out of
// their durations.
//
// It is safe to run repeatedly. A submission whose audio has not changed
// since the last successful sync is skipped by signature, so the sweep
// can run every couple of minutes without rebuilding anything.
func (s *Service) SyncAudio(ctx context.Context, submissionID string) (Submission, error) {
	sub, err := s.repo.Get(ctx, submissionID)
	if err != nil {
		return Submission{}, err
	}

	parts, err := s.repo.AIAudioParts(ctx, sub.AIBookID)
	if err != nil {
		return Submission{}, err
	}

	ready := readyParts(parts)
	if len(ready) == 0 {
		return sub, ErrNoAudioYet
	}

	signature := partsSignature(ready)
	if sub.AudioStatus == "synced" && sub.audioSignature == signature {
		// Nothing changed on the AI side since the last sync. Rebuilding
		// would re-download and re-upload the whole book to produce a
		// byte-identical file.
		return sub, nil
	}

	key, format, duration, chapters, err := s.materialise(ctx, sub, ready)
	if err != nil {
		_ = s.repo.MarkAudioFailed(ctx, submissionID, err.Error())
		return Submission{}, err
	}

	err = s.repo.InTx(ctx, func(tx Repository) error {
		editionID, err := tx.UpsertNarratedEdition(ctx, catalog.NarratedEdition{
			BookID:          sub.CatalogBookID,
			VoiceID:         s.audio.VoiceID,
			VoiceName:       s.audio.VoiceName,
			VoiceStyle:      s.audio.VoiceStyle,
			Language:        "fa",
			PriceIRR:        s.audio.PriceIRR,
			PreviewSeconds:  s.audio.PreviewSeconds,
			DurationSeconds: int(duration + 0.5),
			Chapters:        chapters,
		})
		if err != nil {
			return err
		}

		if _, err := tx.UpsertEditionAsset(ctx, editionID, key, format, int(duration+0.5)); err != nil {
			return err
		}

		// The AI service also writes a generated summary onto its own
		// book row. Carrying it across costs one statement here and is
		// the difference between a catalogue entry with a description
		// and one without; a description an editor typed is never
		// overwritten.
		if summary, err := tx.AIBookDescription(ctx, sub.AIBookID); err == nil && summary != "" {
			if err := tx.SetBookDescriptionIfEmpty(ctx, sub.CatalogBookID, summary); err != nil {
				return err
			}
		}

		return tx.MarkAudioSynced(ctx, submissionID, editionID, signature)
	})
	if err != nil {
		_ = s.repo.MarkAudioFailed(ctx, submissionID, err.Error())
		return Submission{}, err
	}

	return s.Get(ctx, submissionID)
}

// SyncAudioSweep syncs every submission that is waiting for narration.
// One book failing must not stop the rest, so failures are recorded on
// their own row and the sweep continues.
func (s *Service) SyncAudioSweep(ctx context.Context, limit int) (synced int, failed int, err error) {
	ids, err := s.repo.AudioSyncCandidates(ctx, limit)
	if err != nil {
		return 0, 0, err
	}

	for _, id := range ids {
		switch _, err := s.SyncAudio(ctx, id); {
		case err == nil:
			synced++
		case errors.Is(err, ErrNoAudioYet):
			// Still producing. Not an error, not progress.
		default:
			failed++
		}
	}
	return synced, failed, nil
}

// readyParts drops files the AI service has not finished writing. Its
// status column is free text on that side, so anything that is not
// explicitly unfinished counts — a stricter check would silently ignore
// a status value they add later.
func readyParts(parts []aiAudioPart) []aiAudioPart {
	out := make([]aiAudioPart, 0, len(parts))
	for _, p := range parts {
		switch strings.ToLower(p.Status) {
		case "pending", "processing", "failed", "error":
			continue
		}
		if strings.TrimSpace(p.StorageKey) == "" {
			continue
		}
		out = append(out, p)
	}
	return out
}

// partsSignature identifies a set of audio files. Keys and durations
// together catch both a re-narration that reuses the same key and one
// that writes new keys.
func partsSignature(parts []aiAudioPart) string {
	h := sha256.New()
	for _, p := range parts {
		fmt.Fprintf(h, "%s|%.3f\n", p.StorageKey, p.Duration)
	}
	return hex.EncodeToString(h.Sum(nil))[:32]
}

// materialise produces the single file the edition plays, and the
// chapter ranges over it.
func (s *Service) materialise(
	ctx context.Context, sub Submission, parts []aiAudioPart,
) (key, format string, duration float64, chapters []catalog.Chapter, err error) {
	format = firstFormat(parts)

	// One file is the easy and common case for a short book: it is
	// already what the player wants, so it is used where it lies. No
	// download, no re-upload, no second copy of the audio in the bucket.
	if len(parts) == 1 {
		p := parts[0]
		if p.Duration <= 0 {
			return "", "", 0, nil, fmt.Errorf("ingest: audio file %q has no duration", p.StorageKey)
		}
		return p.StorageKey, p.Format, p.Duration, chaptersFrom(parts), nil
	}

	joinedKey := fmt.Sprintf("books/%s/audio/edition.%s", sub.AIBookID, format)
	total, err := s.concatenate(ctx, parts, joinedKey, format)
	if err != nil {
		return "", "", 0, nil, err
	}
	return joinedKey, format, total, chaptersFrom(parts), nil
}

// chaptersFrom lays the parts end to end. The boundaries are cumulative
// durations, which is exactly how they are heard.
func chaptersFrom(parts []aiAudioPart) []catalog.Chapter {
	if len(parts) < 2 && (len(parts) == 0 || parts[0].ChapterTitle == "") {
		// A single untitled file is the whole book; a one-chapter bar
		// says nothing the progress bar does not already say.
		return nil
	}

	out := make([]catalog.Chapter, 0, len(parts))
	var cursor float64
	for i, p := range parts {
		title := p.ChapterTitle
		if title == "" {
			title = fmt.Sprintf("بخش %d", i+1)
		}
		out = append(out, catalog.Chapter{
			Title:        title,
			SortOrder:    i,
			StartSeconds: cursor,
			EndSeconds:   cursor + p.Duration,
		})
		cursor += p.Duration
	}
	return out
}

func firstFormat(parts []aiAudioPart) string {
	for _, p := range parts {
		if f := strings.TrimSpace(p.Format); f != "" {
			return strings.ToLower(f)
		}
	}
	return "mp3"
}

// concatenate joins the parts into one file and uploads it.
//
// ffmpeg's concat demuxer with stream copy is used rather than a
// re-encode: the parts already came out of the TTS pipeline at the
// bitrate we want, and re-encoding them would lose quality to no end.
// Mixed codecs would break stream copy — if the AI service ever emits
// mixed formats, this is where that shows up, loudly, rather than as a
// file that plays half way.
func (s *Service) concatenate(ctx context.Context, parts []aiAudioPart, destKey, format string) (float64, error) {
	ffmpeg := s.audio.FFmpegPath
	if _, err := exec.LookPath(ffmpeg); err != nil {
		return 0, fmt.Errorf("ingest: %s is required to join %d audio files but was not found: %w", ffmpeg, len(parts), err)
	}

	dir, err := os.MkdirTemp("", "ketapod-audio-*")
	if err != nil {
		return 0, fmt.Errorf("ingest: temp dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(dir) }()

	var (
		list  strings.Builder
		total float64
	)
	for i, p := range parts {
		local := filepath.Join(dir, fmt.Sprintf("part-%03d.%s", i, format))
		if err := s.download(ctx, p.StorageKey, local); err != nil {
			return 0, err
		}
		// The concat demuxer reads this list; single quotes are its
		// escaping rule, and the paths here are ours, not the
		// uploader's, so they cannot contain one.
		fmt.Fprintf(&list, "file '%s'\n", local)
		total += p.Duration
	}

	listPath := filepath.Join(dir, "parts.txt")
	if err := os.WriteFile(listPath, []byte(list.String()), 0o600); err != nil {
		return 0, fmt.Errorf("ingest: write concat list: %w", err)
	}

	outPath := filepath.Join(dir, "edition."+format)

	// A long book is a long job; the ceiling exists so a stuck ffmpeg
	// cannot hold a worker forever.
	runCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(runCtx, ffmpeg,
		"-hide_banner", "-loglevel", "error", "-nostdin", "-y",
		"-f", "concat", "-safe", "0", "-i", listPath,
		"-c", "copy", outPath,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		return 0, fmt.Errorf("ingest: ffmpeg concat failed: %w: %s", err, strings.TrimSpace(string(out)))
	}

	file, err := os.Open(outPath)
	if err != nil {
		return 0, fmt.Errorf("ingest: open joined audio: %w", err)
	}
	defer file.Close()

	if err := s.store.PutObject(ctx, destKey, file, audioContentType(format)); err != nil {
		return 0, fmt.Errorf("ingest: upload joined audio: %w", err)
	}
	return total, nil
}

func (s *Service) download(ctx context.Context, key, dest string) error {
	obj, err := s.store.GetObject(ctx, key, "")
	if err != nil {
		return fmt.Errorf("ingest: fetch audio part %q: %w", key, err)
	}
	defer obj.Body.Close()

	file, err := os.Create(dest)
	if err != nil {
		return fmt.Errorf("ingest: create temp part: %w", err)
	}
	defer file.Close()

	if _, err := io.Copy(file, obj.Body); err != nil {
		return fmt.Errorf("ingest: copy audio part %q: %w", key, err)
	}
	return nil
}

func audioContentType(format string) string {
	switch strings.ToLower(format) {
	case "mp3":
		return "audio/mpeg"
	case "m4a", "aac", "mp4":
		return "audio/mp4"
	case "ogg", "opus":
		return "audio/ogg"
	case "wav":
		return "audio/wav"
	default:
		return "application/octet-stream"
	}
}

// compile-time proof that the media write seam is the one being used —
// the ingest module must never write media.* SQL itself.
var _ = media.UpsertEditionAsset
