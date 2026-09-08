-- name: GetDemoSample :one
SELECT * FROM home.demo_sample LIMIT 1;

-- name: GetDemoContinueListening :one
SELECT * FROM home.demo_continue_listening LIMIT 1;

-- name: ListDemoRecommendations :many
SELECT * FROM home.demo_recommendations ORDER BY sort_order;
