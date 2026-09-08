package integrationtest

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"ketapod/internal/identity"
	"ketapod/internal/platform/ratelimit"
	"ketapod/internal/platform/testkit"
)

// otpReader pulls the login code out of the outbox rather than out of a
// fake queue client.
//
// That is the point: the OTP row and its "send this SMS" job are written
// in one transaction, so reading the job back from jobs.outbox tests the
// real durability path. A fake enqueuer would pass even if the job were
// never persisted at all.
type otpReader struct {
	t    *testing.T
	pool *pgxpool.Pool
}

func (r otpReader) lastCode() string {
	r.t.Helper()

	var payload []byte
	err := r.pool.QueryRow(context.Background(), `
		SELECT payload FROM jobs.outbox
		WHERE task_type = $1
		ORDER BY created_at DESC
		LIMIT 1`, identity.TaskTypeSendOTP).Scan(&payload)
	require.NoError(r.t, err, "expected an OTP sms job in the outbox")

	var decoded identity.SendOTPPayload
	require.NoError(r.t, json.Unmarshal(payload, &decoded))
	return decoded.Code
}

func (r otpReader) pendingCount() int {
	r.t.Helper()
	var n int
	require.NoError(r.t, r.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM jobs.outbox WHERE task_type = $1 AND status = 'pending'`,
		identity.TaskTypeSendOTP).Scan(&n))
	return n
}

func newIdentityService(t *testing.T, cfg identity.Config) (*identity.Service, otpReader, *fixtures) {
	t.Helper()
	pool := newPool(t)
	redisClient := testkit.Redis(t)

	if cfg.JWTSecret == "" {
		cfg.JWTSecret = "test-secret"
	}
	if cfg.AccessTokenTTL == 0 {
		cfg.AccessTokenTTL = 15 * time.Minute
	}
	if cfg.RefreshTokenTTL == 0 {
		cfg.RefreshTokenTTL = 30 * 24 * time.Hour
	}
	if cfg.OTPCodeTTL == 0 {
		cfg.OTPCodeTTL = 2 * time.Minute
	}
	if cfg.OTPCodeLength == 0 {
		cfg.OTPCodeLength = 5
	}
	if cfg.OTPMaxAttempts == 0 {
		cfg.OTPMaxAttempts = 5
	}

	svc := identity.NewService(identity.NewRepository(pool), ratelimit.New(redisClient), cfg)
	return svc, otpReader{t: t, pool: pool}, newFixtures(t, pool)
}

func TestOTPLoginFlow(t *testing.T) {
	svc, otp, _ := newIdentityService(t, identity.Config{OTPPerPhonePerWindow: 20})
	ctx := context.Background()
	const phone = "09120000100"

	require.NoError(t, svc.RequestOTP(ctx, phone, "1.2.3.4"))
	code := otp.lastCode()
	require.Len(t, code, 5)

	t.Run("the send job is durable, not fire-and-forget", func(t *testing.T) {
		// The job is committed with the OTP row, so it survives the
		// process dying before anything reaches Redis. Before the
		// outbox this was a plain Enqueue after the commit, and a crash
		// in between meant the user waited for a code nobody had queued.
		require.Equal(t, 1, otp.pendingCount())
	})

	t.Run("a wrong code is rejected", func(t *testing.T) {
		_, err := svc.VerifyOTP(ctx, phone, "00000", nil)
		require.ErrorIs(t, err, identity.ErrInvalidOTP)
	})

	var pair identity.TokenPair
	t.Run("the right code creates the account and issues tokens", func(t *testing.T) {
		var err error
		pair, err = svc.VerifyOTP(ctx, phone, code, &identity.DeviceInfo{
			Platform: "web", Fingerprint: "device-a",
		})
		require.NoError(t, err)
		require.NotEmpty(t, pair.AccessToken)
		require.NotEmpty(t, pair.RefreshToken)
		require.Equal(t, phone, pair.User.PhoneNumber)
		require.Equal(t, identity.StatusActive, pair.User.Status)
	})

	t.Run("the code is single-use", func(t *testing.T) {
		_, err := svc.VerifyOTP(ctx, phone, code, nil)
		require.ErrorIs(t, err, identity.ErrInvalidOTP)
	})

	t.Run("logging in again reuses the account rather than creating a second one", func(t *testing.T) {
		require.NoError(t, svc.RequestOTP(ctx, phone, "1.2.3.4"))
		again, err := svc.VerifyOTP(ctx, phone, otp.lastCode(), nil)
		require.NoError(t, err)
		require.Equal(t, pair.User.ID, again.User.ID)
	})
}

func TestOTPAttemptsAreCapped(t *testing.T) {
	svc, otp, _ := newIdentityService(t, identity.Config{OTPMaxAttempts: 3})
	ctx := context.Background()
	const phone = "09120000101"

	require.NoError(t, svc.RequestOTP(ctx, phone, "1.2.3.4"))
	code := otp.lastCode()

	for range 3 {
		_, err := svc.VerifyOTP(ctx, phone, "00000", nil)
		require.ErrorIs(t, err, identity.ErrInvalidOTP)
	}

	// Brute-forcing a five-digit code takes 100,000 tries; three is the
	// budget. Even the correct code is refused now — the user has to
	// request a new one.
	_, err := svc.VerifyOTP(ctx, phone, code, nil)
	require.ErrorIs(t, err, identity.ErrOTPAttempts)
}

func TestOTPIsRateLimitedPerPhoneAndPerIP(t *testing.T) {
	ctx := context.Background()

	t.Run("per phone number", func(t *testing.T) {
		svc, _, _ := newIdentityService(t, identity.Config{
			OTPPerPhonePerWindow: 2, OTPPerIPPerWindow: 100, OTPRateWindow: time.Minute,
		})
		const phone = "09120000102"

		require.NoError(t, svc.RequestOTP(ctx, phone, "1.2.3.4"))
		require.NoError(t, svc.RequestOTP(ctx, phone, "1.2.3.4"))
		require.ErrorIs(t, svc.RequestOTP(ctx, phone, "1.2.3.4"), identity.ErrRateLimited)
	})

	t.Run("per client IP across different numbers", func(t *testing.T) {
		// The cheapest attack is one script walking a range of numbers
		// from one host: it never trips a per-phone limit, and every
		// send costs real money.
		svc, _, _ := newIdentityService(t, identity.Config{
			OTPPerPhonePerWindow: 100, OTPPerIPPerWindow: 2, OTPRateWindow: time.Minute,
		})

		require.NoError(t, svc.RequestOTP(ctx, "09120000201", "9.9.9.9"))
		require.NoError(t, svc.RequestOTP(ctx, "09120000202", "9.9.9.9"))
		require.ErrorIs(t, svc.RequestOTP(ctx, "09120000203", "9.9.9.9"), identity.ErrRateLimited)

		// A different host is unaffected.
		require.NoError(t, svc.RequestOTP(ctx, "09120000204", "8.8.8.8"))
	})
}

// Rotation alone is not enough. If an attacker steals a refresh token
// and uses it first, the victim's next refresh fails but the attacker
// holds a fresh valid chain. Treating any reuse of a consumed token as
// evidence of compromise kills both chains; the victim re-logs in with
// an SMS, the attacker cannot.
func TestRefreshTokenRotationAndReplayDetection(t *testing.T) {
	svc, otp, _ := newIdentityService(t, identity.Config{})
	ctx := context.Background()
	const phone = "09120000103"

	require.NoError(t, svc.RequestOTP(ctx, phone, "1.2.3.4"))
	first, err := svc.VerifyOTP(ctx, phone, otp.lastCode(), &identity.DeviceInfo{Fingerprint: "d1"})
	require.NoError(t, err)

	second, err := svc.RefreshToken(ctx, first.RefreshToken)
	require.NoError(t, err)
	require.NotEqual(t, first.RefreshToken, second.RefreshToken, "the token rotates")

	third, err := svc.RefreshToken(ctx, second.RefreshToken)
	require.NoError(t, err)

	t.Run("replaying a consumed token is detected", func(t *testing.T) {
		_, err := svc.RefreshToken(ctx, first.RefreshToken)
		require.ErrorIs(t, err, identity.ErrTokenReplayed)
	})

	t.Run("the replay kills the whole family, including the live token", func(t *testing.T) {
		// This is the part that matters: after a replay, the attacker's
		// newest token is dead too.
		//
		// It reports ErrTokenReplayed rather than a plain invalid-token
		// error, and that is the right message for both parties: the
		// legitimate user is told their sessions were closed for safety
		// and to sign in again, instead of a generic "session expired"
		// that hides a compromise.
		_, err := svc.RefreshToken(ctx, third.RefreshToken)
		require.ErrorIs(t, err, identity.ErrTokenReplayed)
	})
}

func TestLogoutRevokesOnlyThatSession(t *testing.T) {
	svc, otp, _ := newIdentityService(t, identity.Config{OTPPerPhonePerWindow: 20})
	ctx := context.Background()
	const phone = "09120000104"

	require.NoError(t, svc.RequestOTP(ctx, phone, "1.2.3.4"))
	phoneSession, err := svc.VerifyOTP(ctx, phone, otp.lastCode(), &identity.DeviceInfo{Fingerprint: "phone"})
	require.NoError(t, err)

	require.NoError(t, svc.RequestOTP(ctx, phone, "1.2.3.4"))
	laptopSession, err := svc.VerifyOTP(ctx, phone, otp.lastCode(), &identity.DeviceInfo{Fingerprint: "laptop"})
	require.NoError(t, err)

	require.NoError(t, svc.Logout(ctx, phoneSession.RefreshToken))

	_, err = svc.RefreshToken(ctx, phoneSession.RefreshToken)
	require.Error(t, err, "the signed-out session is dead")

	_, err = svc.RefreshToken(ctx, laptopSession.RefreshToken)
	require.NoError(t, err, "the other device keeps working")

	t.Run("logout-all kills every session", func(t *testing.T) {
		require.NoError(t, svc.LogoutAll(ctx, laptopSession.User.ID))
		_, err := svc.RefreshToken(ctx, laptopSession.RefreshToken)
		require.Error(t, err)
	})
}

// The devices table exists for the concurrent-playback cap
// (04-architecture.md). Rather than refusing a login — which strands a
// user who changed phones and can only see an error — the least recently
// active device is signed out, which is what streaming apps do.
func TestDeviceCapSignsOutTheOldestDevice(t *testing.T) {
	// The OTP rate limit is raised here because this test logs in four
	// times from one number on purpose; the limit itself is covered by
	// TestOTPIsRateLimitedPerPhoneAndPerIP.
	svc, otp, f := newIdentityService(t, identity.Config{
		MaxActiveDevices: 2, OTPPerPhonePerWindow: 20, OTPPerIPPerWindow: 100,
	})
	ctx := context.Background()
	const phone = "09120000105"

	login := func(fingerprint string) identity.TokenPair {
		t.Helper()
		require.NoError(t, svc.RequestOTP(ctx, phone, "1.2.3.4"))
		pair, err := svc.VerifyOTP(ctx, phone, otp.lastCode(), &identity.DeviceInfo{
			Platform: "android", Fingerprint: fingerprint, Name: fingerprint,
		})
		require.NoError(t, err)
		// last_active_at has second-ish resolution in ordering terms;
		// a brief gap makes "oldest" unambiguous.
		time.Sleep(10 * time.Millisecond)
		return pair
	}

	oldest := login("device-1")
	login("device-2")

	devices, err := svc.ListDevices(ctx, oldest.User.ID)
	require.NoError(t, err)
	require.Len(t, devices, 2)

	login("device-3")

	devices, err = svc.ListDevices(ctx, oldest.User.ID)
	require.NoError(t, err)
	require.Len(t, devices, 2, "the cap holds")

	names := []string{devices[0].Name, devices[1].Name}
	require.NotContains(t, names, "device-1", "the least recently active device was signed out")

	t.Run("the evicted device's refresh token dies with it", func(t *testing.T) {
		// Otherwise "sign out that phone" would be purely cosmetic.
		_, err := svc.RefreshToken(ctx, oldest.RefreshToken)
		require.Error(t, err)
	})

	t.Run("logging in again on a known device does not create a duplicate", func(t *testing.T) {
		login("device-2")
		require.Equal(t, 1, f.countRows(
			"identity.devices", "user_id = $1 AND device_fingerprint = 'device-2' AND revoked_at IS NULL",
			oldest.User.ID))
	})
}

func TestSuspendedAccountLosesAccess(t *testing.T) {
	svc, otp, _ := newIdentityService(t, identity.Config{OTPPerPhonePerWindow: 20})
	ctx := context.Background()
	const phone = "09120000106"

	require.NoError(t, svc.RequestOTP(ctx, phone, "1.2.3.4"))
	session, err := svc.VerifyOTP(ctx, phone, otp.lastCode(), &identity.DeviceInfo{Fingerprint: "d1"})
	require.NoError(t, err)

	_, err = svc.SetStatus(ctx, session.User.ID, identity.StatusSuspended, "abuse")
	require.NoError(t, err)

	t.Run("live sessions are terminated, not left to expire", func(t *testing.T) {
		// An access token stays cryptographically valid until it expires,
		// so a suspension that only stops new logins does nothing for
		// the next fifteen minutes.
		_, err := svc.RefreshToken(ctx, session.RefreshToken)
		require.Error(t, err)
	})

	t.Run("per-request checks refuse the account", func(t *testing.T) {
		_, err := svc.EnsureActive(ctx, session.User.ID)
		require.ErrorIs(t, err, identity.ErrSuspended)
	})

	t.Run("a new login is refused before an SMS is even sent", func(t *testing.T) {
		require.ErrorIs(t, svc.RequestOTP(ctx, phone, "1.2.3.4"), identity.ErrSuspended)
	})

	t.Run("reinstating restores access", func(t *testing.T) {
		_, err := svc.SetStatus(ctx, session.User.ID, identity.StatusActive, "")
		require.NoError(t, err)
		require.NoError(t, svc.RequestOTP(ctx, phone, "1.2.3.4"))

		restored, err := svc.VerifyOTP(ctx, phone, otp.lastCode(), nil)
		require.NoError(t, err)
		require.Equal(t, session.User.ID, restored.User.ID)
	})
}

func TestServiceRegistryReflectsRolesAndProfiles(t *testing.T) {
	// The super-app shell reads this at startup to decide which modules
	// to warm up, so availability is computed on the server — the same
	// rule that keeps kids policy off the client.
	t.Run("a plain user with no children gets listen only", func(t *testing.T) {
		services := identity.ServicesFor(identity.User{Role: identity.RoleUser}, false)
		byID := indexServices(services)

		require.True(t, byID["listen"].Enabled)
		require.False(t, byID["kids"].Enabled)
		require.Equal(t, "no_child_profile", byID["kids"].Reason)
		require.NotNil(t, byID["kids"].CTA)
		require.False(t, byID["studio"].Enabled)
		require.Equal(t, "creator_role_required", byID["studio"].Reason)
	})

	t.Run("kids turns on once a child profile exists", func(t *testing.T) {
		services := identity.ServicesFor(identity.User{Role: identity.RoleUser}, true)
		require.True(t, indexServices(services)["kids"].Enabled)
	})

	t.Run("a creator gets the studio", func(t *testing.T) {
		services := identity.ServicesFor(
			identity.User{Role: identity.RoleUser, Roles: []string{identity.RoleCreator}}, false)
		require.True(t, indexServices(services)["studio"].Enabled)
	})
}

func indexServices(services []identity.ServiceEntry) map[string]identity.ServiceEntry {
	out := make(map[string]identity.ServiceEntry, len(services))
	for _, s := range services {
		out[s.ID] = s
	}
	return out
}
