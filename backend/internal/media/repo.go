package media

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"ketapod/internal/media/sqlcgen"
)

type pgRepo struct {
	q *sqlcgen.Queries
}

func NewRepository(pool *pgxpool.Pool) Repository {
	return &pgRepo{q: sqlcgen.New(pool)}
}

func (r *pgRepo) GetAudioAssetByID(ctx context.Context, id string) (AudioAsset, error) {
	parsedID, err := uuid.Parse(id)
	if err != nil {
		return AudioAsset{}, ErrNotFound
	}
	row, err := r.q.GetAudioAssetByID(ctx, parsedID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AudioAsset{}, ErrNotFound
		}
		return AudioAsset{}, err
	}
	return toAudioAsset(row), nil
}

func (r *pgRepo) GetPrimaryAudioAssetForEdition(ctx context.Context, audioEditionID string) (AudioAsset, error) {
	parsedID, err := uuid.Parse(audioEditionID)
	if err != nil {
		return AudioAsset{}, ErrNotFound
	}
	row, err := r.q.GetPrimaryAudioAssetForEdition(ctx, parsedID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AudioAsset{}, ErrNotFound
		}
		return AudioAsset{}, err
	}
	return toAudioAsset(row), nil
}

func (r *pgRepo) ListAssetsForEdition(ctx context.Context, audioEditionID string) ([]AudioAsset, error) {
	parsedID, err := uuid.Parse(audioEditionID)
	if err != nil {
		return nil, fmt.Errorf("media: parse audio edition id: %w", err)
	}
	rows, err := r.q.ListAudioAssetsForEdition(ctx, parsedID)
	if err != nil {
		return nil, err
	}
	assets := make([]AudioAsset, len(rows))
	for i, row := range rows {
		assets[i] = toAudioAsset(row)
	}
	return assets, nil
}

func toAudioAsset(row sqlcgen.MediaAudioAsset) AudioAsset {
	return AudioAsset{
		ID:              row.ID.String(),
		AudioEditionID:  row.AudioEditionID.String(),
		StorageKey:      row.StorageKey,
		Format:          row.Format,
		BitrateKbps:     int(row.BitrateKbps),
		DurationSeconds: int(row.DurationSeconds),
	}
}
