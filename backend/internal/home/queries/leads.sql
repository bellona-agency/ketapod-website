-- name: CreateLead :one
INSERT INTO home.leads (
    full_name, phone_number, email, user_type, interest_tags, consent,
    source, landing_path, referrer, utm_source, utm_medium, utm_campaign
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
)
RETURNING *;

-- name: FindLeadByPhoneNumber :one
SELECT * FROM home.leads WHERE phone_number = $1;

-- name: FindLeadByEmail :one
SELECT * FROM home.leads WHERE email = $1;
