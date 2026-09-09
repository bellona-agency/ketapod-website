-- name: ListHomeStats :many
SELECT * FROM home.stats ORDER BY sort_order;
