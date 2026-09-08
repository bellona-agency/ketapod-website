-- name: CreateOTPCode :one
INSERT INTO identity.otp_codes (phone_number, code_hash, purpose, expires_at, max_attempts)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetLatestActiveOTP :one
SELECT * FROM identity.otp_codes
WHERE phone_number = $1
  AND purpose = $2
  AND consumed_at IS NULL
  AND expires_at > now()
ORDER BY created_at DESC
LIMIT 1;

-- name: IncrementOTPAttempt :one
UPDATE identity.otp_codes
SET attempt_count = attempt_count + 1
WHERE id = $1
RETURNING *;

-- name: ConsumeOTPCode :exec
UPDATE identity.otp_codes
SET consumed_at = now()
WHERE id = $1;

-- name: CountOTPRequestsSince :one
SELECT count(*) FROM identity.otp_codes
WHERE phone_number = $1 AND created_at > $2;
