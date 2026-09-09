-- name: ListVoices :many
SELECT * FROM catalog.voices ORDER BY sort_order, id;

-- name: GetVoiceByID :one
SELECT * FROM catalog.voices WHERE id = $1;
