// cmd/seed populates a fresh database with just enough catalog, media
// and home-surface data for the Home endpoints (docs/07-api-contract.md)
// and the landing page's Interactive Demo to have something real to
// show. It uploads the placeholder audio clips in seed/assets to object
// storage and wires everything else (voices, books, editions, demo
// curation, localization, social proof) with plain SQL — this is a
// one-shot script, not query-layer code, so it doesn't go through sqlc.
//
// It deliberately does NOT seed home.social_proof_testimonials or
// home.social_proof_partners: decisions.md is explicit that section
// never renders fabricated reviews, and seeding fake ones here would
// violate that the moment anyone points the frontend at a freshly
// seeded database.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5/pgxpool"

	"ketapod/internal/platform/config"
	"ketapod/internal/platform/storage"
)

func main() {
	ctx := context.Background()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("seed: load config: %v", err)
	}

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("seed: connect db: %v", err)
	}
	defer pool.Close()

	store, err := storage.New(ctx, storage.Config{
		Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, Bucket: cfg.S3Bucket,
		AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey, UseSSL: cfg.S3UseSSL,
	})
	if err != nil {
		log.Fatalf("seed: init storage: %v", err)
	}
	if err := store.EnsureBucket(ctx); err != nil {
		log.Fatalf("seed: ensure bucket: %v", err)
	}

	if err := seedVoices(ctx, pool); err != nil {
		log.Fatalf("seed: voices: %v", err)
	}
	if err := seedCategories(ctx, pool); err != nil {
		log.Fatalf("seed: categories: %v", err)
	}
	authorID, err := seedAuthor(ctx, pool)
	if err != nil {
		log.Fatalf("seed: author: %v", err)
	}

	assets := map[string]string{
		"sample":           "sample.m4a",
		"night_story_calm": "night_story_calm.m4a",
		"night_story_kids": "night_story_kids.m4a",
		"little_adventure": "little_adventure.m4a",
		"local_legend":     "local_legend.m4a",
		"short_stories":    "short_stories.m4a",
	}
	assetDir := "seed/assets"
	for key, filename := range assets {
		if err := uploadIfMissing(ctx, store, assetDir, filename); err != nil {
			log.Fatalf("seed: upload %s: %v", key, err)
		}
	}

	sampleBookID, err := seedBookWithEdition(ctx, pool, bookSpec{
		Slug: "majarajooyi-dar-jangal", Title: "ماجراجویی در جنگل", AuthorID: authorID,
		Description: "نمونه‌ای برای سکشن دموی صفحه Home.", CategorySlug: "story",
		IsKidsFriendly: false,
	}, []editionSpec{
		{VoiceID: "voice_narrator_fa_01", IsKidsFriendly: false, StorageKey: "sample.m4a", DurationSeconds: 180},
	})
	if err != nil {
		log.Fatalf("seed: sample book: %v", err)
	}

	nightStoryID, err := seedBookWithEdition(ctx, pool, bookSpec{
		Slug: "ghesse-ye-shab", Title: "قصه شب", AuthorID: authorID,
		Description: "قصه شب برای کودکان.", CategorySlug: "kids", IsKidsFriendly: true,
	}, []editionSpec{
		{VoiceID: "voice_narrator_fa_01", IsKidsFriendly: false, StorageKey: "night_story_calm.m4a", DurationSeconds: 185},
		{VoiceID: "voice_narrator_fa_03", IsKidsFriendly: true, StorageKey: "night_story_kids.m4a", DurationSeconds: 185},
	})
	if err != nil {
		log.Fatalf("seed: night story book: %v", err)
	}

	littleAdventureID, err := seedBookWithEdition(ctx, pool, bookSpec{
		Slug: "majara-ye-koochak", Title: "ماجرای کوچک", AuthorID: authorID,
		Description: "ماجرای کوتاه کودکانه.", CategorySlug: "kids", IsKidsFriendly: true,
	}, []editionSpec{
		{VoiceID: "voice_narrator_fa_03", IsKidsFriendly: true, StorageKey: "little_adventure.m4a", DurationSeconds: 150},
	})
	if err != nil {
		log.Fatalf("seed: little adventure book: %v", err)
	}

	localLegendID, err := seedBookWithEdition(ctx, pool, bookSpec{
		Slug: "afsane-mahalli", Title: "افسانه محلی", AuthorID: authorID,
		Description: "افسانه‌ای از فرهنگ عامه.", CategorySlug: "story", IsKidsFriendly: false,
	}, []editionSpec{
		{VoiceID: "voice_narrator_fa_01", IsKidsFriendly: false, StorageKey: "local_legend.m4a", DurationSeconds: 200},
	})
	if err != nil {
		log.Fatalf("seed: local legend book: %v", err)
	}

	shortStoriesID, err := seedBookWithEdition(ctx, pool, bookSpec{
		Slug: "ghesse-haye-kootah", Title: "قصه‌های کوتاه", AuthorID: authorID,
		Description: "مجموعه قصه‌های کوتاه.", CategorySlug: "story", IsKidsFriendly: false,
	}, []editionSpec{
		{VoiceID: "voice_narrator_fa_01", IsKidsFriendly: false, StorageKey: "short_stories.m4a", DurationSeconds: 160},
	})
	if err != nil {
		log.Fatalf("seed: short stories book: %v", err)
	}

	// One paid title so the purchase -> entitlement -> full playback path
	// has something real to run against. Everything else stays free
	// because the landing page plays it to anonymous visitors.
	if _, err := seedBookWithEdition(ctx, pool, bookSpec{
		Slug: "modiriyat-e-zaman", Title: "مدیریت زمان",
		Description:  "کتاب غیرداستانی نمونه برای آزمودن مسیر خرید و حق دسترسی.",
		CategorySlug: "self-development", AuthorID: authorID, IsKidsFriendly: false,
	}, []editionSpec{
		{
			VoiceID: "voice_narrator_fa_02", IsKidsFriendly: false,
			StorageKey: "short_stories.m4a", DurationSeconds: 160,
			PriceIRR: 450_000, PreviewSeconds: 60,
		},
	}); err != nil {
		log.Fatalf("seed: paid book: %v", err)
	}

	if err := seedHomeDemo(ctx, pool, sampleBookID, shortStoriesID, []recommendationSpec{
		{BookID: nightStoryID, Tag: "AI Suggestion", Type: "ai"},
		{BookID: littleAdventureID, Tag: "Kids", Type: "kids"},
		{BookID: localLegendID, Tag: "Local", Type: "local"},
	}); err != nil {
		log.Fatalf("seed: home demo: %v", err)
	}

	if err := seedHomeStats(ctx, pool); err != nil {
		log.Fatalf("seed: home stats: %v", err)
	}
	if err := seedLocalization(ctx, pool); err != nil {
		log.Fatalf("seed: localization: %v", err)
	}
	if err := seedSocialProofStats(ctx, pool); err != nil {
		log.Fatalf("seed: social proof stats: %v", err)
	}
	if err := seedSubscriptionPlans(ctx, pool); err != nil {
		log.Fatalf("seed: subscription plans: %v", err)
	}
	if err := seedCoupons(ctx, pool); err != nil {
		log.Fatalf("seed: coupons: %v", err)
	}
	if err := seedKidsPrompts(ctx, pool); err != nil {
		log.Fatalf("seed: kids prompts: %v", err)
	}

	fmt.Println("seed: done")
}

func uploadIfMissing(ctx context.Context, store *storage.Storage, dir, filename string) error {
	if _, _, err := store.HeadObject(ctx, filename); err == nil {
		return nil
	}
	path := filepath.Join(dir, filename)
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()
	return store.PutObject(ctx, filename, f, "audio/mp4")
}

func seedVoices(ctx context.Context, pool *pgxpool.Pool) error {
	voices := []struct {
		id, name, style   string
		isDefault, isKids bool
		sortOrder         int
	}{
		{"voice_narrator_fa_01", "آرام", "calm", true, false, 1},
		{"voice_narrator_fa_02", "نمایشی", "dramatic", false, false, 2},
		{"voice_narrator_fa_03", "کودک", "kids", false, true, 3},
	}
	for _, v := range voices {
		_, err := pool.Exec(ctx, `
			INSERT INTO catalog.voices (id, name, style, is_default, is_kids, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (id) DO NOTHING`,
			v.id, v.name, v.style, v.isDefault, v.isKids, v.sortOrder)
		if err != nil {
			return err
		}
	}
	return nil
}

func seedCategories(ctx context.Context, pool *pgxpool.Pool) error {
	categories := []struct{ name, slug string }{
		{"داستان", "story"}, {"کودک", "kids"}, {"توسعه فردی", "self-development"},
	}
	for _, c := range categories {
		_, err := pool.Exec(ctx, `
			INSERT INTO catalog.categories (name, slug) VALUES ($1, $2)
			ON CONFLICT (slug) DO NOTHING`, c.name, c.slug)
		if err != nil {
			return err
		}
	}
	return nil
}

func seedAuthor(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `SELECT id FROM catalog.authors WHERE name = $1`, "نویسنده نمونه").Scan(&id)
	if err == nil {
		return id, nil
	}
	// slug became NOT NULL in 00007_catalog_expansion; an insert without
	// it fails, so the seed carries one rather than relying on a default
	// that only ever existed for rows migrated in.
	err = pool.QueryRow(ctx, `
		INSERT INTO catalog.authors (name, slug) VALUES ($1, $2) RETURNING id`,
		"نویسنده نمونه", "nevisandeh-nemuneh").Scan(&id)
	return id, err
}

type bookSpec struct {
	Slug           string
	Title          string
	Description    string
	CategorySlug   string
	AuthorID       string
	IsKidsFriendly bool
}

type editionSpec struct {
	VoiceID         string
	IsKidsFriendly  bool
	StorageKey      string
	DurationSeconds int
	// PriceIRR of zero means free. The Home demo clips stay free on
	// purpose: the landing page plays them for anonymous visitors, and a
	// price would turn that into a 60-second preview.
	PriceIRR       int64
	PreviewSeconds int
}

func seedBookWithEdition(ctx context.Context, pool *pgxpool.Pool, book bookSpec, editions []editionSpec) (string, error) {
	var bookID string
	err := pool.QueryRow(ctx, `SELECT id FROM catalog.books WHERE slug = $1`, book.Slug).Scan(&bookID)
	if err != nil {
		err = pool.QueryRow(ctx, `
			INSERT INTO catalog.books (slug, title, description, author_id, category_id, is_kids_friendly, cover_url, published_at)
			VALUES ($1, $2, $3, $4, (SELECT id FROM catalog.categories WHERE slug = $5), $6, $7, now())
			RETURNING id`,
			book.Slug, book.Title, book.Description, book.AuthorID, book.CategorySlug, book.IsKidsFriendly,
			fmt.Sprintf("https://placehold.co/400x400.png?text=%s", book.Slug),
		).Scan(&bookID)
		if err != nil {
			return "", fmt.Errorf("insert book: %w", err)
		}
	}

	// A RightsGrant per seeded title, because catalog.HasActiveRights
	// defaults to "we do not have the rights". Without this the seeded
	// catalogue would look unlicensed to every check that asks.
	if _, err := pool.Exec(ctx, `
		INSERT INTO catalog.rights_grants (book_id, scope, revenue_share_percent, contract_ref)
		SELECT $1, 'audio_distribution', 30, 'SEED-DEMO'
		WHERE NOT EXISTS (SELECT 1 FROM catalog.rights_grants WHERE book_id = $1)`, bookID); err != nil {
		return "", fmt.Errorf("insert rights grant: %w", err)
	}

	for _, ed := range editions {
		var editionID string
		err := pool.QueryRow(ctx, `SELECT id FROM catalog.audio_editions WHERE book_id = $1 AND voice_id = $2`,
			bookID, ed.VoiceID).Scan(&editionID)
		if err != nil {
			previewSeconds := ed.PreviewSeconds
			if previewSeconds == 0 {
				previewSeconds = 60
			}
			err = pool.QueryRow(ctx, `
				INSERT INTO catalog.audio_editions
					(book_id, voice_id, narrator_type, is_kids_friendly, price_irr, preview_seconds, duration_seconds, published_at)
				VALUES ($1, $2, 'ai', $3, $4, $5, $6, now())
				RETURNING id`,
				bookID, ed.VoiceID, ed.IsKidsFriendly, ed.PriceIRR, previewSeconds, ed.DurationSeconds,
			).Scan(&editionID)
			if err != nil {
				return "", fmt.Errorf("insert edition: %w", err)
			}
		}

		_, err = pool.Exec(ctx, `
			INSERT INTO media.audio_assets (audio_edition_id, storage_key, format, bitrate_kbps, duration_seconds)
			VALUES ($1, $2, 'm4a', 48, $3)
			ON CONFLICT (audio_edition_id, format) DO NOTHING`,
			editionID, ed.StorageKey, ed.DurationSeconds)
		if err != nil {
			return "", fmt.Errorf("insert audio asset: %w", err)
		}
	}

	return bookID, nil
}

type recommendationSpec struct {
	BookID string
	Tag    string
	Type   string
}

func seedHomeDemo(ctx context.Context, pool *pgxpool.Pool, sampleBookID, continueListeningBookID string, recs []recommendationSpec) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO home.demo_sample (book_id, ai_tag) VALUES ($1, 'پیشنهاد هوشمند')
		ON CONFLICT (book_id) DO NOTHING`, sampleBookID)
	if err != nil {
		return fmt.Errorf("demo_sample: %w", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO home.demo_continue_listening (book_id, progress_percent) VALUES ($1, 68)
		ON CONFLICT (book_id) DO NOTHING`, continueListeningBookID)
	if err != nil {
		return fmt.Errorf("demo_continue_listening: %w", err)
	}

	_, err = pool.Exec(ctx, `DELETE FROM home.demo_recommendations`)
	if err != nil {
		return fmt.Errorf("clear demo_recommendations: %w", err)
	}
	for i, rec := range recs {
		_, err := pool.Exec(ctx, `
			INSERT INTO home.demo_recommendations (book_id, tag, type, sort_order)
			VALUES ($1, $2, $3, $4)`, rec.BookID, rec.Tag, rec.Type, i+1)
		if err != nil {
			return fmt.Errorf("insert demo_recommendation: %w", err)
		}
	}
	return nil
}

func seedHomeStats(ctx context.Context, pool *pgxpool.Pool) error {
	stats := []struct {
		key, label, display string
		value               int64
		sortOrder           int
	}{
		{"books", "کتاب صوتی", "1200+", 1200, 1},
		{"narrators", "گوینده", "18", 18, 2},
		{"categories", "دسته محتوا", "45+", 45, 3},
		{"activeUsers", "کاربر", "20K+", 20000, 4},
	}
	for _, s := range stats {
		_, err := pool.Exec(ctx, `
			INSERT INTO home.stats (key, label, value, display_value, sort_order)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (key) DO UPDATE SET label = $2, value = $3, display_value = $4, sort_order = $5`,
			s.key, s.label, s.value, s.display, s.sortOrder)
		if err != nil {
			return err
		}
	}
	return nil
}

func seedLocalization(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO home.localization_content (id, title, subtitle) VALUES (true, $1, $2)
		ON CONFLICT (id) DO UPDATE SET title = $1, subtitle = $2`,
		"برای زبان‌ها و فرهنگ‌های متنوع",
		"محتوای بومی، زبان‌های مختلف و تجربه‌ای نزدیک‌تر به شنونده.")
	if err != nil {
		return fmt.Errorf("localization_content: %w", err)
	}

	languages := []struct{ code, label string }{
		{"fa", "فارسی"}, {"en", "English"}, {"ar", "العربية"}, {"ku", "کوردی"}, {"tr", "Türkçe"},
	}
	for i, l := range languages {
		_, err := pool.Exec(ctx, `
			INSERT INTO home.localization_languages (code, label, sort_order) VALUES ($1, $2, $3)
			ON CONFLICT (code) DO UPDATE SET label = $2, sort_order = $3`, l.code, l.label, i+1)
		if err != nil {
			return fmt.Errorf("localization_languages: %w", err)
		}
	}

	_, err = pool.Exec(ctx, `DELETE FROM home.localization_topics`)
	if err != nil {
		return fmt.Errorf("clear localization_topics: %w", err)
	}
	topics := []string{"قصه‌های محلی", "ادبیات کودک بومی", "فرهنگ عامه", "افسانه‌ها", "روایت‌های منطقه‌ای"}
	for i, t := range topics {
		_, err := pool.Exec(ctx, `INSERT INTO home.localization_topics (topic, sort_order) VALUES ($1, $2)`, t, i+1)
		if err != nil {
			return fmt.Errorf("insert localization_topic: %w", err)
		}
	}

	_, err = pool.Exec(ctx, `DELETE FROM home.localization_samples`)
	if err != nil {
		return fmt.Errorf("clear localization_samples: %w", err)
	}
	samples := []struct{ title, lang string }{
		{"افسانه‌های محلی", "fa"}, {"Bedtime Stories", "en"}, {"قصه‌های قومی", "ku"},
	}
	for i, s := range samples {
		_, err := pool.Exec(ctx, `
			INSERT INTO home.localization_samples (title, cover_url, language_code, sort_order)
			VALUES ($1, $2, $3, $4)`,
			s.title, fmt.Sprintf("https://placehold.co/300x300.png?text=%s", s.lang), s.lang, i+1)
		if err != nil {
			return fmt.Errorf("insert localization_sample: %w", err)
		}
	}

	return nil
}

// seedSocialProofStats seeds only the numeric KPIs — the same marketing
// figures docs/07-api-contract.md ships as the example payload, not
// fabricated by this script. Testimonials and partners stay empty; see
// the package doc comment.
func seedSocialProofStats(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `DELETE FROM home.social_proof_stats`)
	if err != nil {
		return fmt.Errorf("clear social_proof_stats: %w", err)
	}
	stats := []struct{ label, value string }{
		{"کتاب", "1200+"}, {"صدا", "18"}, {"کاربر", "20K+"}, {"همکار", "24"},
	}
	for i, s := range stats {
		_, err := pool.Exec(ctx, `
			INSERT INTO home.social_proof_stats (label, value, sort_order) VALUES ($1, $2, $3)`,
			s.label, s.value, i+1)
		if err != nil {
			return fmt.Errorf("insert social_proof_stat: %w", err)
		}
	}
	return nil
}

// seedSubscriptionPlans mirrors the capped-hours model from
// 02-business.md. There is deliberately no "unlimited" plan: unlimited
// only attracts the heaviest listeners and eats the margin, and a plan
// row with no cap would make that mistake permanent.
func seedSubscriptionPlans(ctx context.Context, pool *pgxpool.Pool) error {
	plans := []struct {
		code, name string
		priceIRR   int64
		periodDays int
		hourCap    int
		sortOrder  int
	}{
		{"basic_15h", "پایه — ۱۵ ساعت", 1_500_000, 30, 15, 1},
		{"plus_30h", "پلاس — ۳۰ ساعت", 2_600_000, 30, 30, 2},
		{"pro_45h", "حرفه‌ای — ۴۵ ساعت", 3_500_000, 30, 45, 3},
	}
	for _, p := range plans {
		if _, err := pool.Exec(ctx, `
			INSERT INTO commerce.subscription_plans (code, name, price_irr, period_days, monthly_hour_cap, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (code) DO UPDATE SET
				name = $2, price_irr = $3, period_days = $4, monthly_hour_cap = $5, sort_order = $6`,
			p.code, p.name, p.priceIRR, p.periodDays, p.hourCap, p.sortOrder); err != nil {
			return err
		}
	}
	return nil
}

func seedCoupons(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO commerce.coupons (code, kind, value, max_discount_irr, min_subtotal_irr, per_user_limit)
		VALUES ('WELCOME20', 'percent', 20, 200000, 100000, 1)
		ON CONFLICT (code) DO NOTHING`)
	return err
}

// seedKidsPrompts fills the only questions a child may ask Ketabyar.
// The child app sends an id, never text — "no free-text input to the AI"
// is a safety rule, and an id-only interface is the version of it that
// cannot be worked around by a client (03-product-surfaces.md).
func seedKidsPrompts(ctx context.Context, pool *pgxpool.Pool) error {
	prompts := []struct {
		label, text    string
		minAge, maxAge int
		sortOrder      int
	}{
		{"این قصه درباره چیه؟", "این فصل را برای یک کودک به زبان ساده خلاصه کن.", 3, 12, 1},
		{"شخصیت‌ها کی هستن؟", "شخصیت‌های اصلی این فصل را برای کودک معرفی کن.", 4, 12, 2},
		{"بعدش چی می‌شه؟", "بدون لو دادن پایان، بپرس کودک فکر می‌کند بعد چه اتفاقی می‌افتد.", 5, 12, 3},
		{"یه سوال ازم بپرس", "یک پرسش ساده درباره این فصل از کودک بپرس.", 5, 12, 4},
	}
	for _, p := range prompts {
		if _, err := pool.Exec(ctx, `
			INSERT INTO kids.allowed_prompts (label, prompt_text, min_age, max_age, sort_order)
			SELECT $1, $2, $3, $4, $5
			WHERE NOT EXISTS (SELECT 1 FROM kids.allowed_prompts WHERE label = $1)`,
			p.label, p.text, p.minAge, p.maxAge, p.sortOrder); err != nil {
			return err
		}
	}
	return nil
}
