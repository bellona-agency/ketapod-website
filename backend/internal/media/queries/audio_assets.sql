-- name: GetAudioAssetByID :one
SELECT * FROM media.audio_assets WHERE id = $1;

-- name: GetPrimaryAudioAssetForEdition :one
SELECT * FROM media.audio_assets
WHERE audio_edition_id = $1
ORDER BY (format = 'm4a') DESC
LIMIT 1;

-- name: ListAudioAssetsForEditions :many
SELECT * FROM media.audio_assets
WHERE audio_edition_id = ANY(sqlc.arg(audio_edition_ids)::uuid[]);

-- name: CreateAudioAsset :one
INSERT INTO media.audio_assets (audio_edition_id, storage_key, format, bitrate_kbps, duration_seconds, checksum)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListAudioAssetsForEdition :many
SELECT * FROM media.audio_assets WHERE audio_edition_id = $1 ORDER BY format;

-- name: GetAudioAssetForEditionFormat :one
SELECT * FROM media.audio_assets WHERE audio_edition_id = $1 AND format = $2;

-- name: CreateTranscodeJob :one
INSERT INTO media.transcode_jobs (audio_edition_id, status, input_key, output_format)
VALUES ($1, 'pending', $2, $3)
RETURNING *;

-- name: GetTranscodeJobByID :one
SELECT * FROM media.transcode_jobs WHERE id = $1;

-- name: SetTranscodeJobStatus :one
UPDATE media.transcode_jobs
SET status = $2, error = $3, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ListPendingTranscodeJobs :many
SELECT * FROM media.transcode_jobs
WHERE status = 'pending'
ORDER BY created_at
LIMIT $1;

-- name: UpsertAudioAsset :one
INSERT INTO media.audio_assets (audio_edition_id, storage_key, format, duration_seconds)
VALUES (@audio_edition_id, @storage_key, @format, @duration_seconds)
ON CONFLICT (audio_edition_id, format) DO UPDATE
SET storage_key      = EXCLUDED.storage_key,
    duration_seconds = EXCLUDED.duration_seconds
RETURNING id;
