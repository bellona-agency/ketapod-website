package kids

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"ketapod/internal/kids/sqlcgen"
)

type pgRepo struct {
	q *sqlcgen.Queries
}

func NewRepository(pool *pgxpool.Pool) Repository {
	return &pgRepo{q: sqlcgen.New(pool)}
}

func (r *pgRepo) CreateProfile(ctx context.Context, parentUserID, displayName string, birthYear, ageYears int, avatarKey string) (ChildProfile, error) {
	parentUUID, err := uuid.Parse(parentUserID)
	if err != nil {
		return ChildProfile{}, fmt.Errorf("kids: parse parent user id: %w", err)
	}
	var birth *int32
	if birthYear > 0 {
		v := int32(birthYear)
		birth = &v
	}
	row, err := r.q.CreateChildProfile(ctx, sqlcgen.CreateChildProfileParams{
		ParentUserID: parentUUID, DisplayName: displayName,
		BirthYear: birth, AgeYears: int32(ageYears), AvatarKey: nullableString(avatarKey),
	})
	if err != nil {
		return ChildProfile{}, err
	}
	return toProfile(row), nil
}

// GetProfileForParent is the ownership check. Every path that accepts an
// X-Profile-Id header goes through it: the header names a profile, it
// does not prove the caller owns it, and without this any parent could
// read another household's child data by guessing an id.
func (r *pgRepo) GetProfileForParent(ctx context.Context, profileID, parentUserID string) (ChildProfile, error) {
	profileUUID, err := uuid.Parse(profileID)
	if err != nil {
		return ChildProfile{}, ErrNotFound
	}
	parentUUID, err := uuid.Parse(parentUserID)
	if err != nil {
		return ChildProfile{}, fmt.Errorf("kids: parse parent user id: %w", err)
	}
	row, err := r.q.GetChildProfileForParent(ctx, sqlcgen.GetChildProfileForParentParams{
		ID: profileUUID, ParentUserID: parentUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ChildProfile{}, ErrNotFound
		}
		return ChildProfile{}, err
	}
	return toProfile(row), nil
}

func (r *pgRepo) ListProfilesForParent(ctx context.Context, parentUserID string) ([]ChildProfile, error) {
	parentUUID, err := uuid.Parse(parentUserID)
	if err != nil {
		return nil, fmt.Errorf("kids: parse parent user id: %w", err)
	}
	rows, err := r.q.ListChildProfilesForParent(ctx, parentUUID)
	if err != nil {
		return nil, err
	}
	profiles := make([]ChildProfile, len(rows))
	for i, row := range rows {
		profiles[i] = toProfile(row)
	}
	return profiles, nil
}

func (r *pgRepo) UpdateProfile(ctx context.Context, profileID, parentUserID string, displayName *string, ageYears, birthYear *int, avatarKey *string) (ChildProfile, error) {
	profileUUID, err := uuid.Parse(profileID)
	if err != nil {
		return ChildProfile{}, ErrNotFound
	}
	parentUUID, err := uuid.Parse(parentUserID)
	if err != nil {
		return ChildProfile{}, fmt.Errorf("kids: parse parent user id: %w", err)
	}

	var age, birth *int32
	if ageYears != nil {
		v := int32(*ageYears)
		age = &v
	}
	if birthYear != nil {
		v := int32(*birthYear)
		birth = &v
	}

	row, err := r.q.UpdateChildProfile(ctx, sqlcgen.UpdateChildProfileParams{
		ID: profileUUID, ParentUserID: parentUUID,
		DisplayName: displayName, AgeYears: age, BirthYear: birth, AvatarKey: avatarKey,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ChildProfile{}, ErrNotFound
		}
		return ChildProfile{}, err
	}
	return toProfile(row), nil
}

func (r *pgRepo) DeactivateProfile(ctx context.Context, profileID, parentUserID string) error {
	profileUUID, err := uuid.Parse(profileID)
	if err != nil {
		return ErrNotFound
	}
	parentUUID, err := uuid.Parse(parentUserID)
	if err != nil {
		return fmt.Errorf("kids: parse parent user id: %w", err)
	}
	return r.q.DeactivateChildProfile(ctx, sqlcgen.DeactivateChildProfileParams{
		ID: profileUUID, ParentUserID: parentUUID,
	})
}

func (r *pgRepo) UpsertControls(ctx context.Context, c Controls) (Controls, error) {
	profileUUID, err := uuid.Parse(c.ChildProfileID)
	if err != nil {
		return Controls{}, ErrNotFound
	}
	row, err := r.q.UpsertParentalControls(ctx, sqlcgen.UpsertParentalControlsParams{
		ChildProfileID:       profileUUID,
		DailyLimitMinutes:    int32(c.DailyLimitMinutes),
		AllowedFromMinute:    int32(c.AllowedFromMinute),
		AllowedToMinute:      int32(c.AllowedToMinute),
		MaxContentAge:        int32(c.MaxContentAge),
		ApprovalMode:         c.ApprovalMode,
		AutodownloadWifiOnly: c.AutodownloadWifiOnly,
	})
	if err != nil {
		return Controls{}, err
	}
	return toControls(row), nil
}

func (r *pgRepo) GetControls(ctx context.Context, profileID string) (Controls, error) {
	profileUUID, err := uuid.Parse(profileID)
	if err != nil {
		return Controls{}, ErrNotFound
	}
	row, err := r.q.GetParentalControls(ctx, profileUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Controls{}, ErrNotFound
		}
		return Controls{}, err
	}
	return toControls(row), nil
}

func (r *pgRepo) SetExitPin(ctx context.Context, profileID, pinHash string) error {
	profileUUID, err := uuid.Parse(profileID)
	if err != nil {
		return ErrNotFound
	}
	return r.q.SetExitPin(ctx, sqlcgen.SetExitPinParams{
		ChildProfileID: profileUUID, ExitPinHash: nullableString(pinHash),
	})
}

func (r *pgRepo) GetExitPinHash(ctx context.Context, profileID string) (string, error) {
	profileUUID, err := uuid.Parse(profileID)
	if err != nil {
		return "", ErrNotFound
	}
	row, err := r.q.GetParentalControls(ctx, profileUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	return stringOrEmpty(row.ExitPinHash), nil
}

func (r *pgRepo) UpsertApproval(ctx context.Context, profileID, bookID, decision, decidedBy string) error {
	profileUUID, err := uuid.Parse(profileID)
	if err != nil {
		return ErrNotFound
	}
	bookUUID, err := uuid.Parse(bookID)
	if err != nil {
		return ErrNotFound
	}
	deciderUUID, err := uuid.Parse(decidedBy)
	if err != nil {
		return fmt.Errorf("kids: parse decider id: %w", err)
	}
	_, err = r.q.UpsertContentApproval(ctx, sqlcgen.UpsertContentApprovalParams{
		ChildProfileID: profileUUID, BookID: bookUUID, Decision: decision, DecidedBy: deciderUUID,
	})
	return err
}

// GetApprovalDecision returns "" when the parent has never ruled on the
// title, which the policy engine treats differently from an explicit
// allow or block.
func (r *pgRepo) GetApprovalDecision(ctx context.Context, profileID, bookID string) (string, error) {
	profileUUID, err := uuid.Parse(profileID)
	if err != nil {
		return "", ErrNotFound
	}
	bookUUID, err := uuid.Parse(bookID)
	if err != nil {
		return "", ErrNotFound
	}
	row, err := r.q.GetContentApproval(ctx, sqlcgen.GetContentApprovalParams{
		ChildProfileID: profileUUID, BookID: bookUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return row.Decision, nil
}

func (r *pgRepo) ListApprovals(ctx context.Context, profileID string) ([]ContentApproval, error) {
	profileUUID, err := uuid.Parse(profileID)
	if err != nil {
		return nil, ErrNotFound
	}
	rows, err := r.q.ListContentApprovals(ctx, profileUUID)
	if err != nil {
		return nil, err
	}
	approvals := make([]ContentApproval, len(rows))
	for i, row := range rows {
		approvals[i] = ContentApproval{
			ChildProfileID: row.ChildProfileID.String(), BookID: row.BookID.String(),
			Decision: row.Decision, BookTitle: row.Title,
			BookCoverURL: stringOrEmpty(row.CoverUrl), DecidedAt: row.DecidedAt,
		}
	}
	return approvals, nil
}

func (r *pgRepo) DeleteApproval(ctx context.Context, profileID, bookID string) error {
	profileUUID, err := uuid.Parse(profileID)
	if err != nil {
		return ErrNotFound
	}
	bookUUID, err := uuid.Parse(bookID)
	if err != nil {
		return ErrNotFound
	}
	return r.q.DeleteContentApproval(ctx, sqlcgen.DeleteContentApprovalParams{
		ChildProfileID: profileUUID, BookID: bookUUID,
	})
}

func (r *pgRepo) ListAllowedPrompts(ctx context.Context, ageYears int) ([]AllowedPrompt, error) {
	rows, err := r.q.ListAllowedPromptsForAge(ctx, int32(ageYears))
	if err != nil {
		return nil, err
	}
	prompts := make([]AllowedPrompt, len(rows))
	for i, row := range rows {
		prompts[i] = AllowedPrompt{
			ID: row.ID.String(), Label: row.Label, Prompt: row.PromptText,
			MinAge: int(row.MinAge), MaxAge: int(row.MaxAge),
		}
	}
	return prompts, nil
}

func (r *pgRepo) GetAllowedPrompt(ctx context.Context, promptID string) (AllowedPrompt, error) {
	promptUUID, err := uuid.Parse(promptID)
	if err != nil {
		return AllowedPrompt{}, ErrNotFound
	}
	row, err := r.q.GetAllowedPromptByID(ctx, promptUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AllowedPrompt{}, ErrNotFound
		}
		return AllowedPrompt{}, err
	}
	return AllowedPrompt{
		ID: row.ID.String(), Label: row.Label, Prompt: row.PromptText,
		MinAge: int(row.MinAge), MaxAge: int(row.MaxAge),
	}, nil
}

func toProfile(row sqlcgen.KidsChildProfile) ChildProfile {
	profile := ChildProfile{
		ID: row.ID.String(), ParentUserID: row.ParentUserID.String(),
		DisplayName: row.DisplayName, AgeYears: int(row.AgeYears),
		AvatarKey: stringOrEmpty(row.AvatarKey), IsActive: row.IsActive,
		CreatedAt: row.CreatedAt,
	}
	if row.BirthYear != nil {
		profile.BirthYear = int(*row.BirthYear)
	}
	return profile
}

func toControls(row sqlcgen.KidsParentalControl) Controls {
	return Controls{
		ChildProfileID:       row.ChildProfileID.String(),
		DailyLimitMinutes:    int(row.DailyLimitMinutes),
		AllowedFromMinute:    int(row.AllowedFromMinute),
		AllowedToMinute:      int(row.AllowedToMinute),
		MaxContentAge:        int(row.MaxContentAge),
		ApprovalMode:         row.ApprovalMode,
		HasExitPin:           row.ExitPinHash != nil && *row.ExitPinHash != "",
		AutodownloadWifiOnly: row.AutodownloadWifiOnly,
		UpdatedAt:            row.UpdatedAt,
	}
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
