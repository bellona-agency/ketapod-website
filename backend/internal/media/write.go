package media

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"ketapod/internal/media/sqlcgen"
)

// DBTX lets another module hand this package its transaction. Same
// reasoning as catalog.DBTX: media stays the only writer of media.*,
// while the caller keeps its write atomic. The ingest panel needs this
// because registering a narrated edition touches catalog and media
// together — half of it committed is a book that lists as playable and
// then 404s on Play.
type DBTX = sqlcgen.DBTX

// UpsertEditionAsset points an edition at the audio file that plays for
// it. Re-running with the same format replaces the key rather than
// adding a second row, because media.audio_assets is unique per
// (edition, format) and a regenerated narration is a replacement, not a
// second edition.
func UpsertEditionAsset(ctx context.Context, db DBTX, editionID, storageKey, format string, durationSeconds int) (string, error) {
	edition, err := uuid.Parse(editionID)
	if err != nil {
		return "", fmt.Errorf("media: parse edition id: %w", err)
	}

	id, err := sqlcgen.New(db).UpsertAudioAsset(ctx, sqlcgen.UpsertAudioAssetParams{
		AudioEditionID:  edition,
		StorageKey:      storageKey,
		Format:          format,
		DurationSeconds: int32(durationSeconds),
	})
	if err != nil {
		return "", fmt.Errorf("media: upsert audio asset: %w", err)
	}
	return id.String(), nil
}
