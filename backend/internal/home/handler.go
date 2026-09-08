package home

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"time"

	"github.com/go-chi/chi/v5"

	"ketapod/internal/platform/httpkit"
	"ketapod/internal/platform/ratelimit"
)

var phoneNumberRe = regexp.MustCompile(`^09\d{9}$`)

type Handler struct {
	svc     *Service
	limiter *ratelimit.Limiter
	log     *slog.Logger
}

func NewHandler(svc *Service, limiter *ratelimit.Limiter, log *slog.Logger) *Handler {
	return &Handler{svc: svc, limiter: limiter, log: log}
}

func (h *Handler) Routes(r chi.Router) {
	r.Get("/public/home/stats", h.getStats)
	r.Get("/public/home/demo", h.getDemo)
	r.Get("/public/home/audio-items/{bookId}", h.getAudioItem)
	r.Get("/public/home/localization", h.getLocalization)
	r.Get("/public/home/social-proof", h.getSocialProof)
	r.Get("/public/leads/options", h.getLeadOptions)
	r.Post("/public/leads", h.createLead)
}

func (h *Handler) getStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.svc.GetStats(r.Context())
	if err != nil {
		h.log.ErrorContext(r.Context(), "home: get stats failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	out := make([]map[string]any, len(stats))
	for i, s := range stats {
		out[i] = map[string]any{
			"key": s.Key, "label": s.Label, "value": s.Value, "displayValue": s.DisplayValue,
		}
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"stats": out})
}

func (h *Handler) getDemo(w http.ResponseWriter, r *http.Request) {
	demo, err := h.svc.GetDemo(r.Context())
	if err != nil {
		h.log.ErrorContext(r.Context(), "home: get demo failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	voices := make([]map[string]any, len(demo.Voices))
	for i, v := range demo.Voices {
		voices[i] = map[string]any{"id": v.ID, "name": v.Name, "style": v.Style, "isDefault": v.IsDefault}
	}

	recs := make([]map[string]any, len(demo.Recommendations))
	for i, rec := range demo.Recommendations {
		recs[i] = map[string]any{
			"id": rec.ID, "bookId": rec.BookID, "title": rec.Title,
			"coverUrl": rec.CoverURL, "tag": rec.Tag, "type": rec.Type,
		}
	}

	httpkit.JSON(w, http.StatusOK, map[string]any{
		"sampleBook": map[string]any{
			"id": demo.Sample.BookID, "title": demo.Sample.Title, "author": demo.Sample.AuthorName,
			"coverUrl": demo.Sample.CoverURL, "durationSeconds": demo.Sample.DurationSeconds,
			"currentProgressPercent": demo.Sample.CurrentProgressPercent, "aiTag": demo.Sample.AITag,
		},
		"voices":          voices,
		"recommendations": recs,
		"continueListening": map[string]any{
			"id": demo.ContinueListening.ID, "bookId": demo.ContinueListening.BookID,
			"title": demo.ContinueListening.Title, "progressPercent": demo.ContinueListening.ProgressPercent,
			"coverUrl": demo.ContinueListening.CoverURL,
		},
		"uiHints": map[string]any{"kidsModeDefault": false, "autoplayAnimation": false},
	})
}

func (h *Handler) getAudioItem(w http.ResponseWriter, r *http.Request) {
	bookID := chi.URLParam(r, "bookId")

	item, err := h.svc.GetAudioItem(r.Context(), bookID)
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "کتاب یافت نشد")
		return
	}

	sources := make([]map[string]any, len(item.Sources))
	for i, src := range item.Sources {
		sources[i] = map[string]any{
			"voiceId": src.VoiceID, "voiceName": src.VoiceName,
			"audioUrl": src.AudioURL, "isKidsRecommended": src.IsKidsRecommended,
		}
	}

	httpkit.JSON(w, http.StatusOK, map[string]any{
		"id": item.BookID, "bookId": item.BookID, "title": item.Title,
		"durationSeconds": item.DurationSeconds, "coverUrl": item.CoverURL,
		"sources": sources, "isKidsFriendly": item.IsKidsFriendly,
	})
}

func (h *Handler) getLocalization(w http.ResponseWriter, r *http.Request) {
	loc, err := h.svc.GetLocalization(r.Context())
	if err != nil {
		h.log.ErrorContext(r.Context(), "home: get localization failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	languages := make([]map[string]any, len(loc.Languages))
	for i, l := range loc.Languages {
		languages[i] = map[string]any{"code": l.Code, "label": l.Label}
	}
	samples := make([]map[string]any, len(loc.Samples))
	for i, s := range loc.Samples {
		samples[i] = map[string]any{"id": s.ID, "title": s.Title, "coverUrl": s.CoverURL, "language": s.Language}
	}

	httpkit.JSON(w, http.StatusOK, map[string]any{
		"title": loc.Title, "subtitle": loc.Subtitle,
		"languages": languages, "localTopics": loc.LocalTopics, "samples": samples,
	})
}

func (h *Handler) getSocialProof(w http.ResponseWriter, r *http.Request) {
	sp, err := h.svc.GetSocialProof(r.Context())
	if err != nil {
		h.log.ErrorContext(r.Context(), "home: get social proof failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	stats := make([]map[string]any, len(sp.Stats))
	for i, s := range sp.Stats {
		stats[i] = map[string]any{"label": s.Label, "value": s.Value}
	}
	testimonials := make([]map[string]any, len(sp.Testimonials))
	for i, t := range sp.Testimonials {
		testimonials[i] = map[string]any{
			"id": t.ID, "name": t.Name, "role": t.Role, "message": t.Message, "avatarUrl": t.AvatarURL,
		}
	}
	partners := make([]map[string]any, len(sp.Partners))
	for i, p := range sp.Partners {
		partners[i] = map[string]any{"id": p.ID, "name": p.Name, "logoUrl": p.LogoURL}
	}

	httpkit.JSON(w, http.StatusOK, map[string]any{
		"stats": stats, "testimonials": testimonials, "partners": partners,
	})
}

type option struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// getLeadOptions is static, not table-backed: these enumerations mirror
// the fallback constants already shipped in web/components/LeadForm.tsx
// and change only when someone edits the form, so a config table would
// buy nothing this session. ageRanges stays in the contract even though
// the current form doesn't render it — see docs/08-decisions.md.
func (h *Handler) getLeadOptions(w http.ResponseWriter, r *http.Request) {
	httpkit.JSON(w, http.StatusOK, map[string]any{
		"userTypes": []option{
			{Value: "normal", Label: "کاربر عادی"},
			{Value: "parent", Label: "والدین"},
			{Value: "teen", Label: "نوجوان"},
			{Value: "publisher", Label: "ناشر"},
			{Value: "creator", Label: "تولیدکننده محتوا"},
		},
		"ageRanges": []option{
			{Value: "under-12", Label: "زیر ۱۲ سال"},
			{Value: "12-18", Label: "۱۲ تا ۱۸ سال"},
			{Value: "18-plus", Label: "بالای ۱۸ سال"},
		},
		"interestTags": []option{
			{Value: "story", Label: "داستان"},
			{Value: "kids", Label: "کودک"},
			{Value: "self-development", Label: "توسعه فردی"},
			{Value: "education", Label: "آموزشی"},
			{Value: "local", Label: "محتوای بومی"},
			{Value: "multilingual", Label: "چندزبانه"},
		},
		"languages": []option{
			{Value: "fa", Label: "فارسی"},
			{Value: "en", Label: "English"},
			{Value: "ar", Label: "العربية"},
			{Value: "ku", Label: "کوردی"},
			{Value: "tr", Label: "Türkçe"},
		},
	})
}

type leadRequestBody struct {
	FullName     string   `json:"fullName"`
	PhoneNumber  string   `json:"phoneNumber"`
	Email        string   `json:"email"`
	UserType     string   `json:"userType"`
	InterestTags []string `json:"interestTags"`
	Consent      bool     `json:"consent"`
	Source       string   `json:"source"`
	LandingPath  string   `json:"landingPath"`
	Referrer     string   `json:"referrer"`
	Utm          struct {
		Source   string `json:"source"`
		Medium   string `json:"medium"`
		Campaign string `json:"campaign"`
	} `json:"utm"`
}

func (h *Handler) createLead(w http.ResponseWriter, r *http.Request) {
	clientIP := clientIP(r)
	allowed, err := h.limiter.Allow(r.Context(), "lead:"+clientIP, 5, 10*time.Minute)
	if err != nil {
		h.log.ErrorContext(r.Context(), "home: lead rate limit check failed", slog.String("error", err.Error()))
	} else if !allowed {
		httpkit.Error(w, http.StatusTooManyRequests, "rate_limited", "تعداد درخواست بیش از حد مجاز است")
		return
	}

	var body leadRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpkit.ValidationError(w, map[string][]string{"body": {"بدنه درخواست نامعتبر است"}})
		return
	}

	if errs := validateLead(body); len(errs) > 0 {
		httpkit.ValidationError(w, errs)
		return
	}

	lead, err := h.svc.CreateLead(r.Context(), LeadInput{
		FullName: body.FullName, PhoneNumber: body.PhoneNumber, Email: body.Email,
		UserType: body.UserType, InterestTags: body.InterestTags, Consent: body.Consent,
		Source: body.Source, LandingPath: body.LandingPath, Referrer: body.Referrer,
		UTM: Utm{Source: body.Utm.Source, Medium: body.Utm.Medium, Campaign: body.Utm.Campaign},
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrDuplicatePhone):
			httpkit.JSON(w, http.StatusConflict, map[string]string{"status": "duplicate", "duplicateBy": "phoneNumber"})
		case errors.Is(err, ErrDuplicateEmail):
			httpkit.JSON(w, http.StatusConflict, map[string]string{"status": "duplicate", "duplicateBy": "email"})
		default:
			h.log.ErrorContext(r.Context(), "home: create lead failed", slog.String("error", err.Error()))
			httpkit.Error(w, http.StatusInternalServerError, "error", "")
		}
		return
	}

	httpkit.JSON(w, http.StatusCreated, map[string]string{
		"message": "ثبت شد", "leadId": lead.ID, "status": "created",
	})
}

func validateLead(body leadRequestBody) map[string][]string {
	errs := map[string][]string{}

	if len(body.FullName) < 2 {
		errs["fullName"] = append(errs["fullName"], "نام باید حداقل ۲ کاراکتر باشد")
	}
	if body.PhoneNumber == "" && body.Email == "" {
		errs["phoneNumber"] = append(errs["phoneNumber"], "شماره موبایل یا ایمیل الزامی است")
	}
	if body.PhoneNumber != "" && !phoneNumberRe.MatchString(body.PhoneNumber) {
		errs["phoneNumber"] = append(errs["phoneNumber"], "شماره موبایل معتبر نیست")
	}
	if body.UserType == "" {
		errs["userType"] = append(errs["userType"], "این فیلد الزامی است")
	}
	if !body.Consent {
		errs["consent"] = append(errs["consent"], "پذیرش قوانین الزامی است")
	}

	return errs
}

func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return fwd
	}
	return r.RemoteAddr
}
