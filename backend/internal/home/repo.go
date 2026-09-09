package home

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"ketapod/internal/home/sqlcgen"
)

type pgRepo struct {
	q *sqlcgen.Queries
}

func NewRepository(pool *pgxpool.Pool) Repository {
	return &pgRepo{q: sqlcgen.New(pool)}
}

func (r *pgRepo) ListStats(ctx context.Context) ([]Stat, error) {
	rows, err := r.q.ListHomeStats(ctx)
	if err != nil {
		return nil, err
	}
	stats := make([]Stat, len(rows))
	for i, row := range rows {
		stats[i] = Stat{Key: row.Key, Label: row.Label, Value: row.Value, DisplayValue: row.DisplayValue}
	}
	return stats, nil
}

func (r *pgRepo) GetDemoSample(ctx context.Context) (DemoSample, error) {
	row, err := r.q.GetDemoSample(ctx)
	if err != nil {
		return DemoSample{}, err
	}
	return DemoSample{BookID: row.BookID.String(), AITag: row.AiTag}, nil
}

func (r *pgRepo) GetDemoContinueListening(ctx context.Context) (DemoContinueListening, error) {
	row, err := r.q.GetDemoContinueListening(ctx)
	if err != nil {
		return DemoContinueListening{}, err
	}
	return DemoContinueListening{ID: row.ID.String(), BookID: row.BookID.String(), ProgressPercent: int(row.ProgressPercent)}, nil
}

func (r *pgRepo) ListDemoRecommendations(ctx context.Context) ([]DemoRecommendation, error) {
	rows, err := r.q.ListDemoRecommendations(ctx)
	if err != nil {
		return nil, err
	}
	recs := make([]DemoRecommendation, len(rows))
	for i, row := range rows {
		recs[i] = DemoRecommendation{ID: row.ID.String(), BookID: row.BookID.String(), Tag: row.Tag, Type: row.Type}
	}
	return recs, nil
}

func (r *pgRepo) GetLocalizationContent(ctx context.Context) (LocalizationContent, error) {
	row, err := r.q.GetLocalizationContent(ctx)
	if err != nil {
		return LocalizationContent{}, err
	}
	return LocalizationContent{Title: row.Title, Subtitle: row.Subtitle}, nil
}

func (r *pgRepo) ListLocalizationLanguages(ctx context.Context) ([]LocalizationLanguage, error) {
	rows, err := r.q.ListLocalizationLanguages(ctx)
	if err != nil {
		return nil, err
	}
	languages := make([]LocalizationLanguage, len(rows))
	for i, row := range rows {
		languages[i] = LocalizationLanguage{Code: row.Code, Label: row.Label}
	}
	return languages, nil
}

func (r *pgRepo) ListLocalizationTopics(ctx context.Context) ([]string, error) {
	rows, err := r.q.ListLocalizationTopics(ctx)
	if err != nil {
		return nil, err
	}
	topics := make([]string, len(rows))
	for i, row := range rows {
		topics[i] = row.Topic
	}
	return topics, nil
}

func (r *pgRepo) ListLocalizationSamples(ctx context.Context) ([]LocalizationSample, error) {
	rows, err := r.q.ListLocalizationSamples(ctx)
	if err != nil {
		return nil, err
	}
	samples := make([]LocalizationSample, len(rows))
	for i, row := range rows {
		samples[i] = LocalizationSample{
			ID: row.ID.String(), Title: row.Title,
			CoverURL: stringOrEmpty(row.CoverUrl), Language: row.LanguageCode,
		}
	}
	return samples, nil
}

func (r *pgRepo) ListSocialProofStats(ctx context.Context) ([]SocialProofStat, error) {
	rows, err := r.q.ListSocialProofStats(ctx)
	if err != nil {
		return nil, err
	}
	stats := make([]SocialProofStat, len(rows))
	for i, row := range rows {
		stats[i] = SocialProofStat{Label: row.Label, Value: row.Value}
	}
	return stats, nil
}

func (r *pgRepo) ListSocialProofTestimonials(ctx context.Context) ([]Testimonial, error) {
	rows, err := r.q.ListSocialProofTestimonials(ctx)
	if err != nil {
		return nil, err
	}
	testimonials := make([]Testimonial, len(rows))
	for i, row := range rows {
		testimonials[i] = Testimonial{
			ID: row.ID.String(), Name: row.Name, Role: row.Role,
			Message: row.Message, AvatarURL: stringOrEmpty(row.AvatarUrl),
		}
	}
	return testimonials, nil
}

func (r *pgRepo) ListSocialProofPartners(ctx context.Context) ([]Partner, error) {
	rows, err := r.q.ListSocialProofPartners(ctx)
	if err != nil {
		return nil, err
	}
	partners := make([]Partner, len(rows))
	for i, row := range rows {
		partners[i] = Partner{ID: row.ID.String(), Name: row.Name, LogoURL: stringOrEmpty(row.LogoUrl)}
	}
	return partners, nil
}

func (r *pgRepo) CreateLead(ctx context.Context, input LeadInput) (Lead, error) {
	row, err := r.q.CreateLead(ctx, sqlcgen.CreateLeadParams{
		FullName:     input.FullName,
		PhoneNumber:  nullableString(input.PhoneNumber),
		Email:        nullableString(input.Email),
		UserType:     input.UserType,
		InterestTags: input.InterestTags,
		Consent:      input.Consent,
		Source:       nullableString(input.Source),
		LandingPath:  nullableString(input.LandingPath),
		Referrer:     nullableString(input.Referrer),
		UtmSource:    nullableString(input.UTM.Source),
		UtmMedium:    nullableString(input.UTM.Medium),
		UtmCampaign:  nullableString(input.UTM.Campaign),
	})
	if err != nil {
		return Lead{}, err
	}
	return Lead{ID: row.ID.String()}, nil
}

func (r *pgRepo) FindLeadByPhoneNumber(ctx context.Context, phoneNumber string) (bool, error) {
	_, err := r.q.FindLeadByPhoneNumber(ctx, nullableString(phoneNumber))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (r *pgRepo) FindLeadByEmail(ctx context.Context, email string) (bool, error) {
	_, err := r.q.FindLeadByEmail(ctx, nullableString(email))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
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
