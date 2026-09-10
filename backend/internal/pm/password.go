package pm

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Password hashing.
//
// argon2id, not bcrypt: bcrypt silently truncates at 72 bytes, and a
// Persian passphrase reaches 72 bytes in about 24 characters — short
// enough that a teammate typing a sentence as their password would have
// the tail of it ignored without any error.
//
// The parameters below are the OWASP second-choice profile (19 MiB, one
// pass, one lane). They cost roughly 40ms per login on the kind of box
// this tool runs on, which is invisible to a human and expensive to a
// list of stolen hashes.
const (
	argonTime    = 1
	argonMemory  = 19 * 1024
	argonThreads = 1
	argonKeyLen  = 32
	argonSaltLen = 16

	// MinPasswordLength is counted in runes, not bytes. Eight Persian
	// characters is sixteen bytes; a byte-based minimum would quietly
	// demand twice as much of a Persian speaker as of an English one.
	MinPasswordLength = 8
)

var ErrPasswordMismatch = errors.New("pm: password does not match")

// HashPassword returns a self-describing PHC string, so the cost
// parameters travel with the hash and can be raised later without
// invalidating everyone's password.
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("pm: read salt: %w", err)
	}

	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)

	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPassword re-derives the key with the parameters recorded in the
// stored hash and compares in constant time.
func VerifyPassword(encoded, password string) error {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return ErrPasswordMismatch
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return ErrPasswordMismatch
	}

	var memory uint32
	var time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return ErrPasswordMismatch
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return ErrPasswordMismatch
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return ErrPasswordMismatch
	}

	got := argon2.IDKey([]byte(password), salt, time, memory, threads, uint32(len(want)))
	if subtle.ConstantTimeCompare(got, want) != 1 {
		return ErrPasswordMismatch
	}
	return nil
}
