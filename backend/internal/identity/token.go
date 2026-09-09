package identity

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"math/big"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// GenerateOTPCode returns a numeric code of the given length. It uses
// crypto/rand, not math/rand — this gates account access, not a UI
// nicety.
func GenerateOTPCode(length int) (string, error) {
	digits := make([]byte, length)
	for i := range digits {
		n, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", fmt.Errorf("identity: generate otp digit: %w", err)
		}
		digits[i] = byte('0') + byte(n.Int64())
	}
	return string(digits), nil
}

func HashOTPCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

// GenerateOpaqueToken returns a URL-safe random token (the refresh
// token handed to the client) plus its sha256 hash (what's stored in
// identity.refresh_tokens — the plaintext value is never persisted, so
// a database leak alone can't be replayed).
func GenerateOpaqueToken() (plaintext string, hash string, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", fmt.Errorf("identity: generate opaque token: %w", err)
	}
	plaintext = base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(plaintext))
	hash = hex.EncodeToString(sum[:])
	return plaintext, hash, nil
}

func HashOpaqueToken(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

type AccessClaims struct {
	UserID string `json:"sub"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

func IssueAccessToken(secret string, userID, role string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := AccessClaims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", fmt.Errorf("identity: sign access token: %w", err)
	}
	return signed, nil
}
