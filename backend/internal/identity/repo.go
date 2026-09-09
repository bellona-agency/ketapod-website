package identity

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"ketapod/internal/identity/sqlcgen"
	"ketapod/internal/platform/outbox"
)

// pgRepo implements Repository against sqlc-generated code. It is the
// only file in this module that knows about SQL or pgx types — service.go
// and handler.go work entirely in domain types from model.go.
type pgRepo struct {
	pool *pgxpool.Pool
	db   outbox.DBTX
	q    *sqlcgen.Queries
}

func NewRepository(pool *pgxpool.Pool) Repository {
	return &pgRepo{pool: pool, db: pool, q: sqlcgen.New(pool)}
}

// InTx runs fn in a transaction. It exists so the OTP row and the "send
// this SMS" job land together: writing the job outside the transaction
// is the dual write that loses jobs when a process dies between the two.
func (r *pgRepo) InTx(ctx context.Context, fn func(Repository) error) error {
	if r.pool == nil {
		return fn(r)
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("identity: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(&pgRepo{pool: nil, db: tx, q: r.q.WithTx(tx)}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// EnqueueTask writes to the outbox using whatever handle this repo is
// holding — the transaction when inside InTx, the pool otherwise.
func (r *pgRepo) EnqueueTask(ctx context.Context, task outbox.Task) error {
	return outbox.Write(ctx, r.db, task)
}

func (r *pgRepo) GetUserByPhoneNumber(ctx context.Context, phoneNumber string) (User, error) {
	row, err := r.q.GetUserByPhoneNumber(ctx, phoneNumber)
	if err != nil {
		return User{}, err
	}
	return r.hydrateRoles(ctx, toUser(row))
}

func (r *pgRepo) CreateUser(ctx context.Context, phoneNumber string) (User, error) {
	row, err := r.q.CreateUser(ctx, sqlcgen.CreateUserParams{PhoneNumber: phoneNumber})
	if err != nil {
		return User{}, err
	}
	return toUser(row), nil
}

func (r *pgRepo) GetUserByID(ctx context.Context, id string) (User, error) {
	parsedID, err := uuid.Parse(id)
	if err != nil {
		return User{}, fmt.Errorf("identity: parse user id: %w", err)
	}
	row, err := r.q.GetUserByID(ctx, parsedID)
	if err != nil {
		return User{}, err
	}
	return r.hydrateRoles(ctx, toUser(row))
}

// hydrateRoles fills User.Roles from the additive user_roles table. It
// is a second round-trip on the auth path, which is why the middleware
// caches the whole User in Redis rather than calling this per request.
func (r *pgRepo) hydrateRoles(ctx context.Context, user User) (User, error) {
	id, err := uuid.Parse(user.ID)
	if err != nil {
		return user, nil
	}
	roles, err := r.q.ListUserRoles(ctx, id)
	if err != nil {
		return user, err
	}
	user.Roles = roles
	return user, nil
}

func (r *pgRepo) UpdateUserProfile(ctx context.Context, userID string, update ProfileUpdate) (User, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return User{}, fmt.Errorf("identity: parse user id: %w", err)
	}
	row, err := r.q.UpdateUserProfile(ctx, sqlcgen.UpdateUserProfileParams{
		ID: parsedID, FullName: update.FullName, Email: update.Email,
	})
	if err != nil {
		return User{}, err
	}
	return toUser(row), nil
}

func (r *pgRepo) SetKidsModePreference(ctx context.Context, userID string, enabled bool) (User, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return User{}, fmt.Errorf("identity: parse user id: %w", err)
	}
	row, err := r.q.SetKidsModePreference(ctx, sqlcgen.SetKidsModePreferenceParams{
		ID:              parsedID,
		KidsModeEnabled: enabled,
	})
	if err != nil {
		return User{}, err
	}
	return toUser(row), nil
}

func (r *pgRepo) SetUserStatus(ctx context.Context, userID, status, reason string) (User, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return User{}, fmt.Errorf("identity: parse user id: %w", err)
	}
	row, err := r.q.SetUserStatus(ctx, sqlcgen.SetUserStatusParams{
		ID: parsedID, Status: status, SuspendedReason: nullableString(reason),
	})
	if err != nil {
		return User{}, err
	}
	return toUser(row), nil
}

func (r *pgRepo) TouchUserLastSeen(ctx context.Context, userID string) error {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return fmt.Errorf("identity: parse user id: %w", err)
	}
	return r.q.TouchUserLastSeen(ctx, parsedID)
}

func (r *pgRepo) GrantRole(ctx context.Context, userID, role string) error {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return fmt.Errorf("identity: parse user id: %w", err)
	}
	return r.q.GrantUserRole(ctx, sqlcgen.GrantUserRoleParams{UserID: parsedID, Role: role})
}

func (r *pgRepo) CreateOTPCode(ctx context.Context, phoneNumber, codeHash, purpose string, expiresAt time.Time, maxAttempts int) (OTPCode, error) {
	row, err := r.q.CreateOTPCode(ctx, sqlcgen.CreateOTPCodeParams{
		PhoneNumber: phoneNumber,
		CodeHash:    codeHash,
		Purpose:     purpose,
		ExpiresAt:   expiresAt,
		MaxAttempts: int32(maxAttempts),
	})
	if err != nil {
		return OTPCode{}, err
	}
	return toOTPCode(row), nil
}

func (r *pgRepo) GetLatestActiveOTP(ctx context.Context, phoneNumber, purpose string) (OTPCode, error) {
	row, err := r.q.GetLatestActiveOTP(ctx, sqlcgen.GetLatestActiveOTPParams{
		PhoneNumber: phoneNumber,
		Purpose:     purpose,
	})
	if err != nil {
		return OTPCode{}, err
	}
	return toOTPCode(row), nil
}

func (r *pgRepo) IncrementOTPAttempt(ctx context.Context, id string) (OTPCode, error) {
	parsedID, err := uuid.Parse(id)
	if err != nil {
		return OTPCode{}, fmt.Errorf("identity: parse otp id: %w", err)
	}
	row, err := r.q.IncrementOTPAttempt(ctx, parsedID)
	if err != nil {
		return OTPCode{}, err
	}
	return toOTPCode(row), nil
}

func (r *pgRepo) ConsumeOTPCode(ctx context.Context, id string) error {
	parsedID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("identity: parse otp id: %w", err)
	}
	return r.q.ConsumeOTPCode(ctx, parsedID)
}

func (r *pgRepo) UpsertDevice(ctx context.Context, userID string, info DeviceInfo) (Device, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return Device{}, fmt.Errorf("identity: parse user id: %w", err)
	}

	platform := info.Platform
	if platform == "" {
		platform = "web"
	}

	// Without a fingerprint the ON CONFLICT target can't match (the
	// unique index is partial on device_fingerprint IS NOT NULL), so a
	// plain insert is the honest behaviour: an anonymous browser session
	// really is a new device every time.
	if info.Fingerprint == "" {
		row, err := r.q.CreateDevice(ctx, sqlcgen.CreateDeviceParams{
			UserID: parsedID, Platform: platform,
			PushToken: nullableString(info.PushToken), AppVersion: nullableString(info.AppVersion),
		})
		if err != nil {
			return Device{}, err
		}
		return toDevice(row), nil
	}

	row, err := r.q.UpsertDevice(ctx, sqlcgen.UpsertDeviceParams{
		UserID:            parsedID,
		Platform:          platform,
		PushToken:         nullableString(info.PushToken),
		AppVersion:        nullableString(info.AppVersion),
		DeviceFingerprint: nullableString(info.Fingerprint),
		Name:              nullableString(info.Name),
	})
	if err != nil {
		return Device{}, err
	}
	return toDevice(row), nil
}

func (r *pgRepo) ListActiveDevices(ctx context.Context, userID string) ([]Device, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return nil, fmt.Errorf("identity: parse user id: %w", err)
	}
	rows, err := r.q.ListActiveDevicesForUser(ctx, parsedID)
	if err != nil {
		return nil, err
	}
	devices := make([]Device, len(rows))
	for i, row := range rows {
		devices[i] = toDevice(row)
	}
	return devices, nil
}

func (r *pgRepo) CountActiveDevices(ctx context.Context, userID string) (int64, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return 0, fmt.Errorf("identity: parse user id: %w", err)
	}
	return r.q.CountActiveDevicesForUser(ctx, parsedID)
}

func (r *pgRepo) RevokeDevice(ctx context.Context, deviceID, userID string) error {
	parsedDeviceID, err := uuid.Parse(deviceID)
	if err != nil {
		return fmt.Errorf("identity: parse device id: %w", err)
	}
	parsedUserID, err := uuid.Parse(userID)
	if err != nil {
		return fmt.Errorf("identity: parse user id: %w", err)
	}
	if err := r.q.RevokeDevice(ctx, sqlcgen.RevokeDeviceParams{ID: parsedDeviceID, UserID: parsedUserID}); err != nil {
		return err
	}
	// Revoking a device without killing its refresh token would make
	// "sign out that phone" purely cosmetic.
	return r.q.RevokeRefreshTokensForDevice(ctx, pgtype.UUID{Bytes: parsedDeviceID, Valid: true})
}

func (r *pgRepo) RevokeOldestActiveDevice(ctx context.Context, userID string) (Device, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return Device{}, fmt.Errorf("identity: parse user id: %w", err)
	}
	row, err := r.q.RevokeOldestActiveDevice(ctx, parsedID)
	if err != nil {
		return Device{}, err
	}
	if err := r.q.RevokeRefreshTokensForDevice(ctx, pgtype.UUID{Bytes: row.ID, Valid: true}); err != nil {
		return Device{}, err
	}
	return toDevice(row), nil
}

func (r *pgRepo) CreateRefreshToken(ctx context.Context, userID, deviceID, familyID, tokenHash string, expiresAt time.Time) (RefreshToken, error) {
	parsedUserID, err := uuid.Parse(userID)
	if err != nil {
		return RefreshToken{}, fmt.Errorf("identity: parse user id: %w", err)
	}

	deviceUUID, err := toPgUUID(deviceID)
	if err != nil {
		return RefreshToken{}, fmt.Errorf("identity: parse device id: %w", err)
	}

	// A token that starts a new chain is its own family root. Storing
	// the root id on every descendant is what makes "revoke the whole
	// family" a single indexed UPDATE instead of a recursive walk.
	family := uuid.New()
	if familyID != "" {
		family, err = uuid.Parse(familyID)
		if err != nil {
			return RefreshToken{}, fmt.Errorf("identity: parse family id: %w", err)
		}
	}

	row, err := r.q.CreateRefreshToken(ctx, sqlcgen.CreateRefreshTokenParams{
		UserID:    parsedUserID,
		DeviceID:  deviceUUID,
		TokenHash: tokenHash,
		ExpiresAt: expiresAt,
		FamilyID:  family,
	})
	if err != nil {
		return RefreshToken{}, err
	}
	return toRefreshToken(row), nil
}

func (r *pgRepo) GetRefreshTokenByHash(ctx context.Context, tokenHash string) (RefreshToken, error) {
	row, err := r.q.GetRefreshTokenByHash(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return RefreshToken{}, ErrTokenInvalid
		}
		return RefreshToken{}, err
	}
	return toRefreshToken(row), nil
}

func (r *pgRepo) MarkRefreshTokenUsed(ctx context.Context, id, replacedByID string) error {
	parsedID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("identity: parse refresh token id: %w", err)
	}
	replacedBy, err := toPgUUID(replacedByID)
	if err != nil {
		return fmt.Errorf("identity: parse replacement token id: %w", err)
	}
	return r.q.MarkRefreshTokenUsed(ctx, sqlcgen.MarkRefreshTokenUsedParams{
		ID: parsedID, ReplacedByID: replacedBy,
	})
}

func (r *pgRepo) RevokeRefreshTokenByHash(ctx context.Context, tokenHash string) error {
	return r.q.RevokeRefreshTokenByHash(ctx, tokenHash)
}

func (r *pgRepo) RevokeRefreshTokenFamily(ctx context.Context, familyID string) error {
	parsedID, err := uuid.Parse(familyID)
	if err != nil {
		return fmt.Errorf("identity: parse family id: %w", err)
	}
	return r.q.RevokeRefreshTokenFamily(ctx, parsedID)
}

func (r *pgRepo) RevokeAllRefreshTokensForUser(ctx context.Context, userID string) error {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return fmt.Errorf("identity: parse user id: %w", err)
	}
	return r.q.RevokeAllRefreshTokensForUser(ctx, parsedID)
}

func toUser(row sqlcgen.IdentityUser) User {
	return User{
		ID:              row.ID.String(),
		PhoneNumber:     row.PhoneNumber,
		FullName:        stringOrEmpty(row.FullName),
		Email:           stringOrEmpty(row.Email),
		Role:            row.Role,
		Status:          row.Status,
		KidsModeEnabled: row.KidsModeEnabled,
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
}

func toOTPCode(row sqlcgen.IdentityOtpCode) OTPCode {
	code := OTPCode{
		ID:           row.ID.String(),
		PhoneNumber:  row.PhoneNumber,
		CodeHash:     row.CodeHash,
		Purpose:      row.Purpose,
		AttemptCount: int(row.AttemptCount),
		MaxAttempts:  int(row.MaxAttempts),
		ExpiresAt:    row.ExpiresAt,
	}
	code.ConsumedAt = fromPgTimestamptz(row.ConsumedAt)
	return code
}

func toDevice(row sqlcgen.IdentityDevice) Device {
	return Device{
		ID:           row.ID.String(),
		UserID:       row.UserID.String(),
		Platform:     row.Platform,
		Name:         stringOrEmpty(row.Name),
		PushToken:    stringOrEmpty(row.PushToken),
		AppVersion:   stringOrEmpty(row.AppVersion),
		Fingerprint:  stringOrEmpty(row.DeviceFingerprint),
		LastActiveAt: row.LastActiveAt,
		RevokedAt:    fromPgTimestamptz(row.RevokedAt),
	}
}

func toRefreshToken(row sqlcgen.IdentityRefreshToken) RefreshToken {
	rt := RefreshToken{
		ID:        row.ID.String(),
		UserID:    row.UserID.String(),
		FamilyID:  row.FamilyID.String(),
		TokenHash: row.TokenHash,
		ExpiresAt: row.ExpiresAt,
	}
	rt.DeviceID = fromPgUUID(row.DeviceID)
	rt.RevokedAt = fromPgTimestamptz(row.RevokedAt)
	rt.UsedAt = fromPgTimestamptz(row.UsedAt)
	return rt
}

func stringOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func nullableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// toPgUUID/fromPgUUID/fromPgTimestamptz bridge sqlc's pgtype wrappers
// (used for nullable uuid/timestamptz columns) and this module's plain
// string/*time.Time domain types.
func toPgUUID(id string) (pgtype.UUID, error) {
	if id == "" {
		return pgtype.UUID{}, nil
	}
	parsed, err := uuid.Parse(id)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: parsed, Valid: true}, nil
}

func fromPgUUID(id pgtype.UUID) string {
	if !id.Valid {
		return ""
	}
	return uuid.UUID(id.Bytes).String()
}

func fromPgTimestamptz(ts pgtype.Timestamptz) *time.Time {
	if !ts.Valid {
		return nil
	}
	t := ts.Time
	return &t
}
