package identity

import (
	"context"
	"errors"
	"fmt"
	"time"

	"ketapod/internal/platform/outbox"
	"ketapod/internal/platform/ratelimit"
)

var (
	ErrNotFound      = errors.New("identity: not found")
	ErrInvalidOTP    = errors.New("identity: invalid or expired otp")
	ErrOTPAttempts   = errors.New("identity: too many otp attempts")
	ErrTokenInvalid  = errors.New("identity: refresh token invalid or revoked")
	ErrTokenReplayed = errors.New("identity: refresh token replayed, family revoked")
	ErrRateLimited   = errors.New("identity: rate limited")
	ErrSuspended     = errors.New("identity: account suspended")
)

const otpPurposeLogin = "login"

// Repository is what Service needs from storage. repo.go implements it
// against sqlc-generated code.
type Repository interface {
	// InTx and EnqueueTask exist together: a background job must be
	// written in the same transaction as the data that caused it, or it
	// can be lost when the process dies between the two writes.
	InTx(ctx context.Context, fn func(Repository) error) error
	EnqueueTask(ctx context.Context, task outbox.Task) error

	GetUserByPhoneNumber(ctx context.Context, phoneNumber string) (User, error)
	CreateUser(ctx context.Context, phoneNumber string) (User, error)
	GetUserByID(ctx context.Context, id string) (User, error)
	UpdateUserProfile(ctx context.Context, userID string, update ProfileUpdate) (User, error)
	SetKidsModePreference(ctx context.Context, userID string, enabled bool) (User, error)
	SetUserStatus(ctx context.Context, userID, status, reason string) (User, error)
	TouchUserLastSeen(ctx context.Context, userID string) error
	GrantRole(ctx context.Context, userID, role string) error

	CreateOTPCode(ctx context.Context, phoneNumber, codeHash, purpose string, expiresAt time.Time, maxAttempts int) (OTPCode, error)
	GetLatestActiveOTP(ctx context.Context, phoneNumber, purpose string) (OTPCode, error)
	IncrementOTPAttempt(ctx context.Context, id string) (OTPCode, error)
	ConsumeOTPCode(ctx context.Context, id string) error

	UpsertDevice(ctx context.Context, userID string, info DeviceInfo) (Device, error)
	ListActiveDevices(ctx context.Context, userID string) ([]Device, error)
	CountActiveDevices(ctx context.Context, userID string) (int64, error)
	RevokeDevice(ctx context.Context, deviceID, userID string) error
	RevokeOldestActiveDevice(ctx context.Context, userID string) (Device, error)

	CreateRefreshToken(ctx context.Context, userID, deviceID, familyID, tokenHash string, expiresAt time.Time) (RefreshToken, error)
	GetRefreshTokenByHash(ctx context.Context, tokenHash string) (RefreshToken, error)
	MarkRefreshTokenUsed(ctx context.Context, id, replacedByID string) error
	RevokeRefreshTokenByHash(ctx context.Context, tokenHash string) error
	RevokeRefreshTokenFamily(ctx context.Context, familyID string) error
	RevokeAllRefreshTokensForUser(ctx context.Context, userID string) error
}

type Config struct {
	JWTSecret       string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	OTPCodeTTL      time.Duration
	OTPCodeLength   int
	OTPMaxAttempts  int

	// MaxActiveDevices caps concurrent playback the way 04-architecture.md
	// intends the devices table to be used. Zero disables the cap.
	MaxActiveDevices int
	// OTPPerPhonePerWindow / OTPPerIPPerWindow: an SMS costs money on
	// every send. Limiting only by phone leaves the cheapest attack open —
	// one script walking a range of numbers from a single host burns the
	// SMS budget without ever hitting a per-phone limit.
	OTPPerPhonePerWindow int64
	OTPPerIPPerWindow    int64
	OTPRateWindow        time.Duration
}

func (c Config) withDefaults() Config {
	if c.MaxActiveDevices == 0 {
		c.MaxActiveDevices = 5
	}
	if c.OTPPerPhonePerWindow == 0 {
		c.OTPPerPhonePerWindow = 3
	}
	if c.OTPPerIPPerWindow == 0 {
		c.OTPPerIPPerWindow = 20
	}
	if c.OTPRateWindow == 0 {
		c.OTPRateWindow = 10 * time.Minute
	}
	return c
}

type Service struct {
	repo    Repository
	limiter *ratelimit.Limiter
	cfg     Config
}

func NewService(repo Repository, limiter *ratelimit.Limiter, cfg Config) *Service {
	return &Service{repo: repo, limiter: limiter, cfg: cfg.withDefaults()}
}

// RequestOTP is rate-limited per phone number and per client IP, and
// enqueues the send instead of calling the SMS sender inline, so a slow
// provider never holds the HTTP connection open.
func (s *Service) RequestOTP(ctx context.Context, phoneNumber, clientIP string) error {
	allowed, err := s.limiter.Allow(ctx, "otp:phone:"+phoneNumber, s.cfg.OTPPerPhonePerWindow, s.cfg.OTPRateWindow)
	if err != nil {
		return fmt.Errorf("identity: check otp phone rate limit: %w", err)
	}
	if !allowed {
		return ErrRateLimited
	}

	if clientIP != "" {
		allowed, err = s.limiter.Allow(ctx, "otp:ip:"+clientIP, s.cfg.OTPPerIPPerWindow, s.cfg.OTPRateWindow)
		if err != nil {
			return fmt.Errorf("identity: check otp ip rate limit: %w", err)
		}
		if !allowed {
			return ErrRateLimited
		}
	}

	// A suspended account must not be able to start a login at all. Doing
	// this check here rather than at verify time also stops the platform
	// from paying for an SMS it will refuse to honour.
	if user, err := s.repo.GetUserByPhoneNumber(ctx, phoneNumber); err == nil && !user.IsActive() {
		return ErrSuspended
	}

	code, err := GenerateOTPCode(s.cfg.OTPCodeLength)
	if err != nil {
		return err
	}

	// The OTP row and the "send this SMS" job commit together. If the
	// send were enqueued after the commit and the process died in
	// between, the user would wait for a code that was never queued —
	// and would have burned one of their three rate-limited attempts
	// doing it.
	return s.repo.InTx(ctx, func(tx Repository) error {
		if _, err := tx.CreateOTPCode(ctx, phoneNumber, HashOTPCode(code), otpPurposeLogin,
			time.Now().Add(s.cfg.OTPCodeTTL), s.cfg.OTPMaxAttempts); err != nil {
			return fmt.Errorf("identity: create otp code: %w", err)
		}

		return tx.EnqueueTask(ctx, outbox.Task{
			Type:     TaskTypeSendOTP,
			Payload:  SendOTPPayload{PhoneNumber: phoneNumber, Code: code},
			Queue:    outbox.QueueCritical,
			MaxRetry: 3,
		})
	})
}

func (s *Service) VerifyOTP(ctx context.Context, phoneNumber, code string, device *DeviceInfo) (TokenPair, error) {
	otp, err := s.repo.GetLatestActiveOTP(ctx, phoneNumber, otpPurposeLogin)
	if err != nil {
		return TokenPair{}, ErrInvalidOTP
	}

	if otp.AttemptCount >= otp.MaxAttempts {
		return TokenPair{}, ErrOTPAttempts
	}

	if otp.CodeHash != HashOTPCode(code) {
		if _, incErr := s.repo.IncrementOTPAttempt(ctx, otp.ID); incErr != nil {
			return TokenPair{}, fmt.Errorf("identity: increment otp attempt: %w", incErr)
		}
		return TokenPair{}, ErrInvalidOTP
	}

	if err := s.repo.ConsumeOTPCode(ctx, otp.ID); err != nil {
		return TokenPair{}, fmt.Errorf("identity: consume otp code: %w", err)
	}

	user, err := s.repo.GetUserByPhoneNumber(ctx, phoneNumber)
	if err != nil {
		user, err = s.repo.CreateUser(ctx, phoneNumber)
		if err != nil {
			return TokenPair{}, fmt.Errorf("identity: create user: %w", err)
		}
	}
	if !user.IsActive() {
		return TokenPair{}, ErrSuspended
	}

	var deviceID string
	if device != nil {
		d, err := s.registerDevice(ctx, user.ID, *device)
		if err != nil {
			return TokenPair{}, err
		}
		deviceID = d.ID
	}

	pair, err := s.issueTokenPair(ctx, user, deviceID, "")
	if err != nil {
		return TokenPair{}, err
	}
	return pair.TokenPair, nil
}

// registerDevice enforces the concurrent-device cap. Rather than
// refusing the login — which strands a user who changed phones and can
// only see the error, never the device list — it revokes the least
// recently active device and its refresh tokens. That is the behaviour
// users expect from streaming apps, and it keeps the cap meaningful.
func (s *Service) registerDevice(ctx context.Context, userID string, info DeviceInfo) (Device, error) {
	device, err := s.repo.UpsertDevice(ctx, userID, info)
	if err != nil {
		return Device{}, fmt.Errorf("identity: upsert device: %w", err)
	}

	if s.cfg.MaxActiveDevices <= 0 {
		return device, nil
	}

	count, err := s.repo.CountActiveDevices(ctx, userID)
	if err != nil {
		return Device{}, fmt.Errorf("identity: count active devices: %w", err)
	}
	for count > int64(s.cfg.MaxActiveDevices) {
		if _, err := s.repo.RevokeOldestActiveDevice(ctx, userID); err != nil {
			return Device{}, fmt.Errorf("identity: revoke oldest device: %w", err)
		}
		count--
	}

	return device, nil
}

// RefreshToken rotates the refresh token and detects replay.
//
// Rotation alone is not enough: if an attacker steals a token and uses
// it first, the victim's next refresh fails but the attacker holds a
// fresh, valid chain. The fix is to treat *any* use of an
// already-consumed token as evidence of compromise and kill the whole
// family — both the attacker's chain and the victim's. The victim
// re-logs in with an SMS; the attacker cannot.
func (s *Service) RefreshToken(ctx context.Context, refreshTokenPlaintext string) (TokenPair, error) {
	hash := HashOpaqueToken(refreshTokenPlaintext)

	existing, err := s.repo.GetRefreshTokenByHash(ctx, hash)
	if err != nil {
		return TokenPair{}, ErrTokenInvalid
	}

	if existing.UsedAt != nil || existing.RevokedAt != nil {
		if err := s.repo.RevokeRefreshTokenFamily(ctx, existing.FamilyID); err != nil {
			return TokenPair{}, fmt.Errorf("identity: revoke replayed token family: %w", err)
		}
		return TokenPair{}, ErrTokenReplayed
	}

	if time.Now().After(existing.ExpiresAt) {
		return TokenPair{}, ErrTokenInvalid
	}

	user, err := s.repo.GetUserByID(ctx, existing.UserID)
	if err != nil {
		return TokenPair{}, fmt.Errorf("identity: get user: %w", err)
	}
	if !user.IsActive() {
		if err := s.repo.RevokeAllRefreshTokensForUser(ctx, user.ID); err != nil {
			return TokenPair{}, fmt.Errorf("identity: revoke tokens of inactive user: %w", err)
		}
		return TokenPair{}, ErrSuspended
	}

	pair, err := s.issueTokenPair(ctx, user, existing.DeviceID, existing.FamilyID)
	if err != nil {
		return TokenPair{}, err
	}

	if err := s.repo.MarkRefreshTokenUsed(ctx, existing.ID, pair.newRefreshTokenID); err != nil {
		return TokenPair{}, fmt.Errorf("identity: mark refresh token used: %w", err)
	}

	return pair.TokenPair, nil
}

func (s *Service) Logout(ctx context.Context, refreshTokenPlaintext string) error {
	hash := HashOpaqueToken(refreshTokenPlaintext)
	if err := s.repo.RevokeRefreshTokenByHash(ctx, hash); err != nil {
		return fmt.Errorf("identity: revoke refresh token: %w", err)
	}
	return nil
}

func (s *Service) LogoutAll(ctx context.Context, userID string) error {
	if err := s.repo.RevokeAllRefreshTokensForUser(ctx, userID); err != nil {
		return fmt.Errorf("identity: revoke all refresh tokens: %w", err)
	}
	return nil
}

func (s *Service) GetUser(ctx context.Context, userID string) (User, error) {
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return User{}, ErrNotFound
	}
	return user, nil
}

// EnsureActive is the per-request guard behind a valid JWT. Access
// tokens are short-lived but not instantly revocable, so a user
// suspended for abuse would otherwise keep full access for the rest of
// the token's TTL. Callers cache the result briefly — see
// AuthenticatedUser middleware.
func (s *Service) EnsureActive(ctx context.Context, userID string) (User, error) {
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return User{}, ErrNotFound
	}
	if !user.IsActive() {
		return User{}, ErrSuspended
	}
	return user, nil
}

func (s *Service) UpdateProfile(ctx context.Context, userID string, update ProfileUpdate) (User, error) {
	user, err := s.repo.UpdateUserProfile(ctx, userID, update)
	if err != nil {
		return User{}, fmt.Errorf("identity: update profile: %w", err)
	}
	return user, nil
}

func (s *Service) SetKidsModePreference(ctx context.Context, userID string, enabled bool) (User, error) {
	user, err := s.repo.SetKidsModePreference(ctx, userID, enabled)
	if err != nil {
		return User{}, fmt.Errorf("identity: set kids mode preference: %w", err)
	}
	return user, nil
}

func (s *Service) ListDevices(ctx context.Context, userID string) ([]Device, error) {
	devices, err := s.repo.ListActiveDevices(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("identity: list devices: %w", err)
	}
	return devices, nil
}

func (s *Service) RevokeDevice(ctx context.Context, userID, deviceID string) error {
	if err := s.repo.RevokeDevice(ctx, deviceID, userID); err != nil {
		return fmt.Errorf("identity: revoke device: %w", err)
	}
	return nil
}

func (s *Service) SetStatus(ctx context.Context, userID, status, reason string) (User, error) {
	user, err := s.repo.SetUserStatus(ctx, userID, status, reason)
	if err != nil {
		return User{}, fmt.Errorf("identity: set user status: %w", err)
	}
	// A suspension that leaves live sessions running is not a suspension.
	if status != StatusActive {
		if err := s.repo.RevokeAllRefreshTokensForUser(ctx, userID); err != nil {
			return User{}, fmt.Errorf("identity: revoke tokens after status change: %w", err)
		}
	}
	return user, nil
}

func (s *Service) GrantRole(ctx context.Context, userID, role string) error {
	if err := s.repo.GrantRole(ctx, userID, role); err != nil {
		return fmt.Errorf("identity: grant role: %w", err)
	}
	return nil
}

// issuedPair carries the new refresh token's row id alongside the public
// TokenPair, so RefreshToken can link the consumed token to its
// replacement without a second lookup.
type issuedPair struct {
	TokenPair
	newRefreshTokenID string
}

func (s *Service) issueTokenPair(ctx context.Context, user User, deviceID, familyID string) (issuedPair, error) {
	accessToken, err := IssueAccessToken(s.cfg.JWTSecret, user.ID, user.Role, s.cfg.AccessTokenTTL)
	if err != nil {
		return issuedPair{}, err
	}

	refreshPlaintext, refreshHash, err := GenerateOpaqueToken()
	if err != nil {
		return issuedPair{}, err
	}

	created, err := s.repo.CreateRefreshToken(ctx, user.ID, deviceID, familyID, refreshHash, time.Now().Add(s.cfg.RefreshTokenTTL))
	if err != nil {
		return issuedPair{}, fmt.Errorf("identity: create refresh token: %w", err)
	}

	return issuedPair{
		TokenPair: TokenPair{
			AccessToken:  accessToken,
			RefreshToken: refreshPlaintext,
			ExpiresIn:    int64(s.cfg.AccessTokenTTL.Seconds()),
			User:         user,
		},
		newRefreshTokenID: created.ID,
	}, nil
}
