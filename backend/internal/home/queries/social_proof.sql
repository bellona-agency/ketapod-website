-- name: ListSocialProofStats :many
SELECT * FROM home.social_proof_stats ORDER BY sort_order;

-- name: ListSocialProofTestimonials :many
SELECT * FROM home.social_proof_testimonials ORDER BY sort_order;

-- name: ListSocialProofPartners :many
SELECT * FROM home.social_proof_partners ORDER BY sort_order;
