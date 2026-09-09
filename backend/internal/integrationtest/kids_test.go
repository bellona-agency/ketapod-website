package integrationtest

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"ketapod/internal/catalog"
	"ketapod/internal/commerce"
	"ketapod/internal/kids"
	"ketapod/internal/library"
)

func newKidsService(t *testing.T) (*kids.Service, *library.Service, *fixtures) {
	t.Helper()
	pool := newPool(t)

	catalogSvc := catalog.NewService(catalog.NewRepository(pool))
	commerceSvc := commerce.NewService(commerce.NewRepository(pool), catalogSvc, nil,
		commerce.NewStubProvider("http://localhost/cb"))
	librarySvc := library.NewService(library.NewRepository(pool), catalogSvc, commerceSvc, catalogSvc, false)
	kidsSvc := kids.NewService(kids.NewRepository(pool), catalogSvc,
		kidsListeningAdapter{lib: librarySvc}, "Asia/Tehran")

	return kidsSvc, librarySvc, newFixtures(t, pool)
}

func TestChildProfileCreationSetsSafeDefaults(t *testing.T) {
	svc, _, f := newKidsService(t)
	ctx := context.Background()

	parentID := f.user("09120000500")

	profile, err := svc.CreateProfile(ctx, parentID, "سارا", 6, 1398, "")
	require.NoError(t, err)
	require.Equal(t, "سارا", profile.DisplayName)
	require.True(t, profile.IsActive)

	t.Run("controls exist from the moment the profile does", func(t *testing.T) {
		// A profile without a control row would fall through every
		// policy check and behave like an unrestricted adult account.
		controls, err := svc.GetControls(ctx, parentID, profile.ID)
		require.NoError(t, err)
		require.Equal(t, 60, controls.DailyLimitMinutes)
		require.Equal(t, kids.ApprovalKidsCatalog, controls.ApprovalMode)
		require.True(t, controls.AutodownloadWifiOnly)
	})

	t.Run("bad input is refused", func(t *testing.T) {
		_, err := svc.CreateProfile(ctx, parentID, "ا", 6, 0, "")
		require.ErrorIs(t, err, kids.ErrInvalidInput, "a one-character name")

		_, err = svc.CreateProfile(ctx, parentID, "کودک", 25, 0, "")
		require.ErrorIs(t, err, kids.ErrInvalidInput, "an impossible age")
	})

	t.Run("a household is capped at six profiles", func(t *testing.T) {
		// An organisation needing dozens of child accounts is the b2b
		// seat model, not this.
		for i := range 5 {
			_, err := svc.CreateProfile(ctx, parentID, "کودک", i+1, 0, "")
			require.NoError(t, err)
		}
		_, err := svc.CreateProfile(ctx, parentID, "یکی بیشتر", 8, 0, "")
		require.ErrorIs(t, err, kids.ErrInvalidInput)
	})
}

// X-Profile-Id names a profile; it does not prove ownership. Without a
// check on every path, any parent could read another household's child
// data by guessing an id — the worst kind of leak this product could have.
func TestChildProfilesAreIsolatedBetweenHouseholds(t *testing.T) {
	svc, _, f := newKidsService(t)
	ctx := context.Background()

	parentA := f.user("09120000501")
	parentB := f.user("09120000502")

	childA, err := svc.CreateProfile(ctx, parentA, "کودک الف", 6, 0, "")
	require.NoError(t, err)

	bookID := f.book(bookOpts{Slug: "any-book", Title: "کتاب", IsKidsFriendly: true})

	for _, tc := range []struct {
		name string
		call func() error
	}{
		{"read the profile", func() error { _, err := svc.GetProfile(ctx, parentB, childA.ID); return err }},
		{"read the controls", func() error { _, err := svc.GetControls(ctx, parentB, childA.ID); return err }},
		{"change the controls", func() error {
			_, err := svc.UpdateControls(ctx, parentB, kids.Controls{
				ChildProfileID: childA.ID, DailyLimitMinutes: 600,
				AllowedToMinute: 1439, MaxContentAge: 18, ApprovalMode: kids.ApprovalKidsCatalog,
			})
			return err
		}},
		{"approve content", func() error { return svc.SetApproval(ctx, parentB, childA.ID, bookID, "allow") }},
		{"list approvals", func() error { _, err := svc.ListApprovals(ctx, parentB, childA.ID); return err }},
		{"read screen time", func() error { _, err := svc.ScreenTime(ctx, parentB, childA.ID); return err }},
		{"read the weekly report", func() error { _, err := svc.WeeklyReport(ctx, parentB, childA.ID); return err }},
		{"set an exit PIN", func() error { return svc.SetExitPin(ctx, parentB, childA.ID, "1234") }},
	} {
		t.Run("another parent cannot "+tc.name, func(t *testing.T) {
			require.ErrorIs(t, tc.call(), kids.ErrNotFound)
		})
	}

	t.Run("the owning parent can", func(t *testing.T) {
		_, err := svc.GetProfile(ctx, parentA, childA.ID)
		require.NoError(t, err)
	})

	t.Run("listing only ever returns your own children", func(t *testing.T) {
		_, err := svc.CreateProfile(ctx, parentB, "کودک ب", 7, 0, "")
		require.NoError(t, err)

		aProfiles, err := svc.ListProfiles(ctx, parentA)
		require.NoError(t, err)
		require.Len(t, aProfiles, 1)
		require.Equal(t, "کودک الف", aProfiles[0].DisplayName)
	})
}

func TestExitPinGatesLeavingKidsMode(t *testing.T) {
	svc, _, f := newKidsService(t)
	ctx := context.Background()

	parentID := f.user("09120000503")
	profile, err := svc.CreateProfile(ctx, parentID, "سارا", 6, 0, "")
	require.NoError(t, err)

	t.Run("before a PIN is set, verification says so explicitly", func(t *testing.T) {
		require.ErrorIs(t, svc.VerifyExitPin(ctx, profile.ID, "1234"), kids.ErrNoPinSet)
	})

	t.Run("a PIN must be a reasonable length", func(t *testing.T) {
		require.ErrorIs(t, svc.SetExitPin(ctx, parentID, profile.ID, "12"), kids.ErrInvalidInput)
		require.ErrorIs(t, svc.SetExitPin(ctx, parentID, profile.ID, "123456789"), kids.ErrInvalidInput)
	})

	require.NoError(t, svc.SetExitPin(ctx, parentID, profile.ID, "4271"))

	t.Run("the right PIN unlocks and a wrong one does not", func(t *testing.T) {
		require.NoError(t, svc.VerifyExitPin(ctx, profile.ID, "4271"))
		require.ErrorIs(t, svc.VerifyExitPin(ctx, profile.ID, "0000"), kids.ErrWrongPin)
	})

	t.Run("the PIN is never stored in plain text", func(t *testing.T) {
		// A four-digit PIN is not a password and hashing it is not
		// meaningful protection against a database thief. It protects
		// against the likelier case: the PIN leaking into a log, a
		// backup, or a support screen.
		var stored string
		require.NoError(t, f.pool.QueryRow(ctx,
			`SELECT exit_pin_hash FROM kids.parental_controls WHERE child_profile_id = $1`,
			profile.ID).Scan(&stored))
		require.NotEmpty(t, stored)
		require.NotContains(t, stored, "4271")
	})

	t.Run("two children with the same PIN do not share a hash", func(t *testing.T) {
		second, err := svc.CreateProfile(ctx, parentID, "علی", 8, 0, "")
		require.NoError(t, err)
		require.NoError(t, svc.SetExitPin(ctx, parentID, second.ID, "4271"))

		var a, b string
		require.NoError(t, f.pool.QueryRow(ctx,
			`SELECT exit_pin_hash FROM kids.parental_controls WHERE child_profile_id = $1`, profile.ID).Scan(&a))
		require.NoError(t, f.pool.QueryRow(ctx,
			`SELECT exit_pin_hash FROM kids.parental_controls WHERE child_profile_id = $1`, second.ID).Scan(&b))
		require.NotEqual(t, a, b, "the profile id salts the hash")
	})
}

// "No free-text input to the AI" is a safety decision, not a product
// one. An id-only interface is the version of it a client cannot work
// around, so the prompt text never leaves the server.
func TestKidsAssistantAcceptsOnlyPreApprovedPrompts(t *testing.T) {
	svc, _, f := newKidsService(t)
	ctx := context.Background()

	parentID := f.user("09120000504")
	profile, err := svc.CreateProfile(ctx, parentID, "سارا", 6, 0, "")
	require.NoError(t, err)

	var youngPromptID, teenPromptID string
	require.NoError(t, f.pool.QueryRow(ctx, `
		INSERT INTO kids.allowed_prompts (label, prompt_text, min_age, max_age, sort_order)
		VALUES ('این قصه درباره چیه؟', 'این فصل را برای کودک خلاصه کن.', 3, 9, 1)
		RETURNING id`).Scan(&youngPromptID))
	require.NoError(t, f.pool.QueryRow(ctx, `
		INSERT INTO kids.allowed_prompts (label, prompt_text, min_age, max_age, sort_order)
		VALUES ('موضوع اصلی چیست؟', 'موضوع اصلی این فصل را تحلیل کن.', 12, 18, 2)
		RETURNING id`).Scan(&teenPromptID))

	t.Run("only age-appropriate prompts are offered", func(t *testing.T) {
		prompts, err := svc.ListAllowedPrompts(ctx, parentID, profile.ID)
		require.NoError(t, err)
		require.Len(t, prompts, 1)
		require.Equal(t, "این قصه درباره چیه؟", prompts[0].Label)
	})

	t.Run("a valid id resolves to server-side text", func(t *testing.T) {
		text, err := svc.ResolvePrompt(ctx, parentID, profile.ID, youngPromptID)
		require.NoError(t, err)
		require.Equal(t, "این فصل را برای کودک خلاصه کن.", text)
	})

	t.Run("a prompt outside the child's age band is refused", func(t *testing.T) {
		// Even a real id from the table does not work if the child is
		// not old enough for it.
		_, err := svc.ResolvePrompt(ctx, parentID, profile.ID, teenPromptID)
		require.ErrorIs(t, err, kids.ErrNotFound)
	})

	t.Run("an unknown id is refused", func(t *testing.T) {
		_, err := svc.ResolvePrompt(ctx, parentID, profile.ID, "00000000-0000-0000-0000-000000000000")
		require.ErrorIs(t, err, kids.ErrNotFound)
	})
}

// The weekly report is the most important parent-retention tool in the
// product, so it is assembled server-side: the web chart and the mobile
// summary must be the same numbers.
func TestWeeklyReport(t *testing.T) {
	svc, _, f := newKidsService(t)
	ctx := context.Background()

	parentID := f.user("09120000505")
	profile, err := svc.CreateProfile(ctx, parentID, "سارا", 6, 0, "")
	require.NoError(t, err)

	bookID := f.book(bookOpts{Slug: "bedtime", Title: "قصه شب", IsKidsFriendly: true})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", IsKidsFriendly: true, WithAsset: true})

	now := time.Now()
	// Two days at the 60-minute limit, one day well under it.
	f.listeningEvent(parentID, profile.ID, editionID, bookID, 60*60, now)
	f.listeningEvent(parentID, profile.ID, editionID, bookID, 60*60, now.AddDate(0, 0, -1))
	f.listeningEvent(parentID, profile.ID, editionID, bookID, 10*60, now.AddDate(0, 0, -2))

	report, err := svc.WeeklyReport(ctx, parentID, profile.ID)
	require.NoError(t, err)

	require.Equal(t, "سارا", report.DisplayName)
	require.Equal(t, int64(130*60), report.TotalSeconds)
	require.Equal(t, 3, report.DaysListened)
	require.Equal(t, 2, report.LimitReachedDays, "the parent sees which days hit the cap")
	require.Len(t, report.TopBooks, 1)
	require.Equal(t, "قصه شب", report.TopBooks[0].Title)

	t.Run("a parent's own listening is not counted in the child's report", func(t *testing.T) {
		f.listeningEvent(parentID, "", editionID, bookID, 99*60, now)

		refreshed, err := svc.WeeklyReport(ctx, parentID, profile.ID)
		require.NoError(t, err)
		require.Equal(t, int64(130*60), refreshed.TotalSeconds)
	})
}

func TestControlsValidation(t *testing.T) {
	svc, _, f := newKidsService(t)
	ctx := context.Background()

	parentID := f.user("09120000506")
	profile, err := svc.CreateProfile(ctx, parentID, "سارا", 6, 0, "")
	require.NoError(t, err)

	valid := kids.Controls{
		ChildProfileID: profile.ID, DailyLimitMinutes: 45,
		AllowedFromMinute: 19 * 60, AllowedToMinute: 7 * 60, // a bedtime window
		MaxContentAge: 8, ApprovalMode: kids.ApprovalAllowlistOnly,
	}
	saved, err := svc.UpdateControls(ctx, parentID, valid)
	require.NoError(t, err)
	require.Equal(t, 45, saved.DailyLimitMinutes)
	require.Equal(t, kids.ApprovalAllowlistOnly, saved.ApprovalMode)

	for _, tc := range []struct {
		name   string
		mutate func(*kids.Controls)
	}{
		{"a negative daily limit", func(c *kids.Controls) { c.DailyLimitMinutes = -1 }},
		{"more minutes than a day has", func(c *kids.Controls) { c.DailyLimitMinutes = 2000 }},
		{"a minute-of-day out of range", func(c *kids.Controls) { c.AllowedFromMinute = 1500 }},
		{"an impossible content age", func(c *kids.Controls) { c.MaxContentAge = 30 }},
		{"an unknown approval mode", func(c *kids.Controls) { c.ApprovalMode = "whatever" }},
	} {
		t.Run(tc.name+" is refused", func(t *testing.T) {
			bad := valid
			tc.mutate(&bad)
			_, err := svc.UpdateControls(ctx, parentID, bad)
			require.ErrorIs(t, err, kids.ErrInvalidInput)
		})
	}
}
