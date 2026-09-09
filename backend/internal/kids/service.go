package kids

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"ketapod/internal/catalog"
)

var (
	ErrNotFound     = errors.New("kids: not found")
	ErrInvalidInput = errors.New("kids: invalid input")
	ErrWrongPin     = errors.New("kids: incorrect exit pin")
	ErrNoPinSet     = errors.New("kids: no exit pin configured")
)

// maxChildProfiles bounds how many profiles one account can hold. It is
// a household, not a school: an org needing dozens of child accounts is
// the b2b seat model, not this.
const maxChildProfiles = 6

type Repository interface {
	CreateProfile(ctx context.Context, parentUserID, displayName string, birthYear, ageYears int, avatarKey string) (ChildProfile, error)
	GetProfileForParent(ctx context.Context, profileID, parentUserID string) (ChildProfile, error)
	ListProfilesForParent(ctx context.Context, parentUserID string) ([]ChildProfile, error)
	UpdateProfile(ctx context.Context, profileID, parentUserID string, displayName *string, ageYears, birthYear *int, avatarKey *string) (ChildProfile, error)
	DeactivateProfile(ctx context.Context, profileID, parentUserID string) error

	UpsertControls(ctx context.Context, c Controls) (Controls, error)
	GetControls(ctx context.Context, profileID string) (Controls, error)
	SetExitPin(ctx context.Context, profileID, pinHash string) error
	GetExitPinHash(ctx context.Context, profileID string) (string, error)

	UpsertApproval(ctx context.Context, profileID, bookID, decision, decidedBy string) error
	GetApprovalDecision(ctx context.Context, profileID, bookID string) (string, error)
	ListApprovals(ctx context.Context, profileID string) ([]ContentApproval, error)
	DeleteApproval(ctx context.Context, profileID, bookID string) error

	ListAllowedPrompts(ctx context.Context, ageYears int) ([]AllowedPrompt, error)
	GetAllowedPrompt(ctx context.Context, promptID string) (AllowedPrompt, error)
}

// BookReader is catalog's slice: whether a title is kids-appropriate at
// all. kids never queries catalog.books directly.
type BookReader interface {
	GetBookByID(ctx context.Context, id string) (catalog.Book, error)
}

// ListeningReader is library's slice: how much the child has listened
// today, and the numbers behind the weekly report. It is expressed in
// this module's own types so kids never imports library; cmd/api owns
// the adapter, which is what a composition root is for.
type ListeningReader interface {
	SecondsListenedToday(ctx context.Context, profileID string, loc *time.Location) (int64, error)
	WeeklyTotals(ctx context.Context, parentUserID, profileID, tz string, since time.Time) (totalSeconds int64, daily []DayTotal, top []BookTotal, err error)
}

type Service struct {
	repo      Repository
	books     BookReader
	listening ListeningReader
	location  *time.Location
}

func NewService(repo Repository, books BookReader, listening ListeningReader, timezone string) *Service {
	// Every time-based parental control — the daily reset, the allowed
	// hours — is expressed in the family's local day, not UTC. A limit
	// that resets at 03:30 Tehran time is indistinguishable from a bug.
	loc, err := time.LoadLocation(timezone)
	if err != nil || timezone == "" {
		loc = time.FixedZone("Asia/Tehran", 3*3600+1800)
	}
	return &Service{repo: repo, books: books, listening: listening, location: loc}
}

func (s *Service) CreateProfile(ctx context.Context, parentUserID, displayName string, ageYears, birthYear int, avatarKey string) (ChildProfile, error) {
	displayName = strings.TrimSpace(displayName)
	if len([]rune(displayName)) < 2 || ageYears < 0 || ageYears > 18 {
		return ChildProfile{}, ErrInvalidInput
	}

	existing, err := s.repo.ListProfilesForParent(ctx, parentUserID)
	if err != nil {
		return ChildProfile{}, err
	}
	if len(existing) >= maxChildProfiles {
		return ChildProfile{}, ErrInvalidInput
	}

	profile, err := s.repo.CreateProfile(ctx, parentUserID, displayName, birthYear, ageYears, avatarKey)
	if err != nil {
		return ChildProfile{}, fmt.Errorf("kids: create profile: %w", err)
	}

	// Controls are created with the profile, never lazily. A profile
	// without a control row would fall through every policy check and
	// behave like an unrestricted adult account.
	if _, err := s.repo.UpsertControls(ctx, DefaultControls(profile.ID, ageYears)); err != nil {
		return ChildProfile{}, fmt.Errorf("kids: create default controls: %w", err)
	}

	return profile, nil
}

func (s *Service) ListProfiles(ctx context.Context, parentUserID string) ([]ChildProfile, error) {
	return s.repo.ListProfilesForParent(ctx, parentUserID)
}

// CountProfilesForParent backs the super-app service registry: the kids
// tile is only enabled once a profile exists.
func (s *Service) CountProfilesForParent(ctx context.Context, parentUserID string) (int, error) {
	profiles, err := s.repo.ListProfilesForParent(ctx, parentUserID)
	if err != nil {
		return 0, err
	}
	return len(profiles), nil
}

func (s *Service) GetProfile(ctx context.Context, parentUserID, profileID string) (ChildProfile, error) {
	return s.repo.GetProfileForParent(ctx, profileID, parentUserID)
}

func (s *Service) UpdateProfile(ctx context.Context, parentUserID, profileID string, displayName *string, ageYears, birthYear *int, avatarKey *string) (ChildProfile, error) {
	if ageYears != nil && (*ageYears < 0 || *ageYears > 18) {
		return ChildProfile{}, ErrInvalidInput
	}
	return s.repo.UpdateProfile(ctx, profileID, parentUserID, displayName, ageYears, birthYear, avatarKey)
}

func (s *Service) DeleteProfile(ctx context.Context, parentUserID, profileID string) error {
	return s.repo.DeactivateProfile(ctx, profileID, parentUserID)
}

func (s *Service) GetControls(ctx context.Context, parentUserID, profileID string) (Controls, error) {
	if _, err := s.repo.GetProfileForParent(ctx, profileID, parentUserID); err != nil {
		return Controls{}, err
	}
	return s.repo.GetControls(ctx, profileID)
}

func (s *Service) UpdateControls(ctx context.Context, parentUserID string, c Controls) (Controls, error) {
	if _, err := s.repo.GetProfileForParent(ctx, c.ChildProfileID, parentUserID); err != nil {
		return Controls{}, err
	}
	switch {
	case c.DailyLimitMinutes < 0 || c.DailyLimitMinutes > 24*60:
		return Controls{}, ErrInvalidInput
	case c.AllowedFromMinute < 0 || c.AllowedFromMinute > 1439:
		return Controls{}, ErrInvalidInput
	case c.AllowedToMinute < 0 || c.AllowedToMinute > 1439:
		return Controls{}, ErrInvalidInput
	case c.MaxContentAge < 0 || c.MaxContentAge > 18:
		return Controls{}, ErrInvalidInput
	case c.ApprovalMode != ApprovalAllowlistOnly && c.ApprovalMode != ApprovalKidsCatalog:
		return Controls{}, ErrInvalidInput
	}
	return s.repo.UpsertControls(ctx, c)
}

// SetExitPin stores a hash, never the PIN.
//
// A four-digit PIN has ten thousand possibilities, so a hash is not
// meaningful protection against an attacker with the database — it
// protects against the far likelier case: the PIN leaking into a log, a
// backup, or a support screen. It is not a password and is not treated
// as one.
func (s *Service) SetExitPin(ctx context.Context, parentUserID, profileID, pin string) error {
	if _, err := s.repo.GetProfileForParent(ctx, profileID, parentUserID); err != nil {
		return err
	}
	if len(pin) < 4 || len(pin) > 8 {
		return ErrInvalidInput
	}
	return s.repo.SetExitPin(ctx, profileID, hashPin(profileID, pin))
}

// VerifyExitPin gates leaving kids mode. The comparison is constant-time
// so the check cannot be turned into a digit-by-digit oracle.
func (s *Service) VerifyExitPin(ctx context.Context, profileID, pin string) error {
	stored, err := s.repo.GetExitPinHash(ctx, profileID)
	if err != nil {
		return err
	}
	if stored == "" {
		return ErrNoPinSet
	}
	if subtle.ConstantTimeCompare([]byte(stored), []byte(hashPin(profileID, pin))) != 1 {
		return ErrWrongPin
	}
	return nil
}

func hashPin(profileID, pin string) string {
	// The profile id acts as a per-profile salt so two children with the
	// same PIN do not share a hash.
	sum := sha256.Sum256([]byte(profileID + ":" + pin))
	return hex.EncodeToString(sum[:])
}

func (s *Service) SetApproval(ctx context.Context, parentUserID, profileID, bookID, decision string) error {
	if decision != "allow" && decision != "block" {
		return ErrInvalidInput
	}
	if _, err := s.repo.GetProfileForParent(ctx, profileID, parentUserID); err != nil {
		return err
	}
	return s.repo.UpsertApproval(ctx, profileID, bookID, decision, parentUserID)
}

func (s *Service) ListApprovals(ctx context.Context, parentUserID, profileID string) ([]ContentApproval, error) {
	if _, err := s.repo.GetProfileForParent(ctx, profileID, parentUserID); err != nil {
		return nil, err
	}
	return s.repo.ListApprovals(ctx, profileID)
}

func (s *Service) ClearApproval(ctx context.Context, parentUserID, profileID, bookID string) error {
	if _, err := s.repo.GetProfileForParent(ctx, profileID, parentUserID); err != nil {
		return err
	}
	return s.repo.DeleteApproval(ctx, profileID, bookID)
}

// CheckPlayback is the function media calls before serving a single
// byte to a child profile. It is the enforcement point for all four
// rules 03-product-surfaces.md says must never be broken, and it lives
// here — in the backend — precisely so that forgetting it in one of the
// three clients cannot bypass it.
func (s *Service) CheckPlayback(ctx context.Context, parentUserID, childProfileID, bookID string) (bool, string, error) {
	profile, err := s.repo.GetProfileForParent(ctx, childProfileID, parentUserID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			// An unowned or unknown profile id is a denial, not an
			// error: a client sending someone else's profile header
			// gets nothing, and learns nothing about whether it exists.
			return false, ReasonProfileInactive, nil
		}
		return false, "", err
	}

	controls, err := s.repo.GetControls(ctx, childProfileID)
	if err != nil {
		if !errors.Is(err, ErrNotFound) {
			return false, "", err
		}
		controls = DefaultControls(childProfileID, profile.AgeYears)
	}

	book, err := s.books.GetBookByID(ctx, bookID)
	if err != nil {
		return false, "", fmt.Errorf("kids: read book: %w", err)
	}

	decision, err := s.repo.GetApprovalDecision(ctx, childProfileID, bookID)
	if err != nil {
		return false, "", err
	}

	secondsToday, err := s.listening.SecondsListenedToday(ctx, childProfileID, s.location)
	if err != nil {
		return false, "", fmt.Errorf("kids: read screen time: %w", err)
	}

	allowed, reason := EvaluatePlayback(PlaybackInput{
		Controls:           controls,
		ChildAgeYears:      profile.AgeYears,
		ProfileActive:      profile.IsActive,
		BookIsKidsFriendly: book.IsKidsFriendly,
		ExplicitDecision:   decision,
		SecondsToday:       secondsToday,
		Now:                time.Now().In(s.location),
	})
	return allowed, reason, nil
}

// ScreenTime is the countdown the kids app shows. Same numbers the
// policy enforces, so the child is never told they have ten minutes left
// and then cut off.
type ScreenTime struct {
	SecondsToday     int64
	RemainingSeconds int64
	WithinHours      bool
}

func (s *Service) ScreenTime(ctx context.Context, parentUserID, profileID string) (ScreenTime, error) {
	if _, err := s.repo.GetProfileForParent(ctx, profileID, parentUserID); err != nil {
		return ScreenTime{}, err
	}
	controls, err := s.repo.GetControls(ctx, profileID)
	if err != nil {
		return ScreenTime{}, err
	}
	secondsToday, err := s.listening.SecondsListenedToday(ctx, profileID, s.location)
	if err != nil {
		return ScreenTime{}, err
	}
	return ScreenTime{
		SecondsToday:     secondsToday,
		RemainingSeconds: RemainingSecondsToday(controls, secondsToday),
		WithinHours:      WithinAllowedHours(controls, time.Now().In(s.location)),
	}, nil
}

func (s *Service) ListAllowedPrompts(ctx context.Context, parentUserID, profileID string) ([]AllowedPrompt, error) {
	profile, err := s.repo.GetProfileForParent(ctx, profileID, parentUserID)
	if err != nil {
		return nil, err
	}
	return s.repo.ListAllowedPrompts(ctx, profile.AgeYears)
}

// ResolvePrompt turns a prompt id into prompt text. Ketabyar for a child
// accepts only ids, never free text — "no free-text input to the AI" is
// a safety decision, not a product one (03-product-surfaces.md), and an
// id-only interface is the only version of it that cannot be worked
// around by a client.
func (s *Service) ResolvePrompt(ctx context.Context, parentUserID, profileID, promptID string) (string, error) {
	profile, err := s.repo.GetProfileForParent(ctx, profileID, parentUserID)
	if err != nil {
		return "", err
	}
	prompt, err := s.repo.GetAllowedPrompt(ctx, promptID)
	if err != nil {
		return "", err
	}
	if profile.AgeYears < prompt.MinAge || profile.AgeYears > prompt.MaxAge {
		return "", ErrNotFound
	}
	return prompt.Prompt, nil
}

// WeeklyReport is the parent-facing summary. It is assembled here, not
// in the web dashboard, so the chart on the web and the summary card in
// the app are literally the same numbers — and so "days the limit was
// reached" is defined once rather than guessed at by each client.
func (s *Service) WeeklyReport(ctx context.Context, parentUserID, profileID string) (WeeklyReport, error) {
	profile, err := s.repo.GetProfileForParent(ctx, profileID, parentUserID)
	if err != nil {
		return WeeklyReport{}, err
	}
	controls, err := s.repo.GetControls(ctx, profileID)
	if err != nil {
		if !errors.Is(err, ErrNotFound) {
			return WeeklyReport{}, err
		}
		controls = DefaultControls(profileID, profile.AgeYears)
	}

	to := time.Now().In(s.location)
	from := to.AddDate(0, 0, -7)

	total, daily, top, err := s.listening.WeeklyTotals(ctx, parentUserID, profileID, s.location.String(), from)
	if err != nil {
		return WeeklyReport{}, fmt.Errorf("kids: weekly totals: %w", err)
	}

	limitSeconds := int64(controls.DailyLimitMinutes) * 60
	limitReached := 0
	for _, day := range daily {
		if limitSeconds > 0 && day.SecondsListened >= limitSeconds {
			limitReached++
		}
	}

	return WeeklyReport{
		ChildProfileID: profileID, DisplayName: profile.DisplayName,
		From: from, To: to, TotalSeconds: total,
		DaysListened: len(daily), DailyBreakdown: daily, TopBooks: top,
		LimitReachedDays: limitReached,
	}, nil
}
