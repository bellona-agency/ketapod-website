-- name: GetLocalizationContent :one
SELECT * FROM home.localization_content LIMIT 1;

-- name: ListLocalizationLanguages :many
SELECT * FROM home.localization_languages ORDER BY sort_order;

-- name: ListLocalizationTopics :many
SELECT * FROM home.localization_topics ORDER BY sort_order;

-- name: ListLocalizationSamples :many
SELECT * FROM home.localization_samples ORDER BY sort_order;
