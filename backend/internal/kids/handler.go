package kids

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"ketapod/internal/platform/httpkit"
)

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// Routes are all parent-authenticated. There is no child-authenticated
// surface at all: a child never holds a token, and every request on
// their behalf is the parent's session plus an X-Profile-Id header
// (08-decisions.md).
func (h *Handler) Routes(r chi.Router, requireAuth func(http.Handler) http.Handler) {
	r.Group(func(r chi.Router) {
		r.Use(requireAuth)

		r.Get("/me/kids/profiles", h.listProfiles)
		r.Post("/me/kids/profiles", h.createProfile)
		r.Patch("/me/kids/profiles/{profileId}", h.updateProfile)
		r.Delete("/me/kids/profiles/{profileId}", h.deleteProfile)

		r.Get("/me/kids/profiles/{profileId}/controls", h.getControls)
		r.Put("/me/kids/profiles/{profileId}/controls", h.updateControls)
		r.Put("/me/kids/profiles/{profileId}/exit-pin", h.setExitPin)
		r.Post("/me/kids/profiles/{profileId}/exit-pin/verify", h.verifyExitPin)

		r.Get("/me/kids/profiles/{profileId}/approvals", h.listApprovals)
		r.Put("/me/kids/profiles/{profileId}/approvals/{bookId}", h.setApproval)
		r.Delete("/me/kids/profiles/{profileId}/approvals/{bookId}", h.clearApproval)

		r.Get("/me/kids/profiles/{profileId}/screen-time", h.screenTime)
		r.Get("/me/kids/profiles/{profileId}/weekly-report", h.weeklyReport)
		r.Get("/me/kids/profiles/{profileId}/prompts", h.listPrompts)
	})
}

type createProfileBody struct {
	DisplayName string `json:"displayName"`
	AgeYears    int    `json:"ageYears"`
	BirthYear   int    `json:"birthYear"`
	AvatarKey   string `json:"avatarKey"`
}

func (h *Handler) createProfile(w http.ResponseWriter, r *http.Request) {
	var body createProfileBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	profile, err := h.svc.CreateProfile(r.Context(), userID, body.DisplayName, body.AgeYears, body.BirthYear, body.AvatarKey)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			httpkit.ValidationError(w, map[string][]string{
				"displayName": {"نام و سن کودک را بررسی کنید (حداکثر ۶ پروفایل)"},
			})
			return
		}
		h.log.ErrorContext(r.Context(), "kids: create profile failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.JSON(w, http.StatusCreated, profileResponse(profile))
}

func (h *Handler) listProfiles(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	profiles, err := h.svc.ListProfiles(r.Context(), userID)
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	out := make([]map[string]any, len(profiles))
	for i, p := range profiles {
		out[i] = profileResponse(p)
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"profiles": out})
}

type updateProfileBody struct {
	DisplayName *string `json:"displayName"`
	AgeYears    *int    `json:"ageYears"`
	BirthYear   *int    `json:"birthYear"`
	AvatarKey   *string `json:"avatarKey"`
}

func (h *Handler) updateProfile(w http.ResponseWriter, r *http.Request) {
	var body updateProfileBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	profile, err := h.svc.UpdateProfile(r.Context(), userID, chi.URLParam(r, "profileId"),
		body.DisplayName, body.AgeYears, body.BirthYear, body.AvatarKey)
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "پروفایل یافت نشد")
		return
	}
	httpkit.JSON(w, http.StatusOK, profileResponse(profile))
}

func (h *Handler) deleteProfile(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	if err := h.svc.DeleteProfile(r.Context(), userID, chi.URLParam(r, "profileId")); err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) getControls(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	controls, err := h.svc.GetControls(r.Context(), userID, chi.URLParam(r, "profileId"))
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "تنظیمات یافت نشد")
		return
	}
	httpkit.JSON(w, http.StatusOK, controlsResponse(controls))
}

type controlsBody struct {
	DailyLimitMinutes    int    `json:"dailyLimitMinutes"`
	AllowedFromMinute    int    `json:"allowedFromMinute"`
	AllowedToMinute      int    `json:"allowedToMinute"`
	MaxContentAge        int    `json:"maxContentAge"`
	ApprovalMode         string `json:"approvalMode"`
	AutodownloadWifiOnly bool   `json:"autodownloadWifiOnly"`
}

func (h *Handler) updateControls(w http.ResponseWriter, r *http.Request) {
	var body controlsBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	controls, err := h.svc.UpdateControls(r.Context(), userID, Controls{
		ChildProfileID:       chi.URLParam(r, "profileId"),
		DailyLimitMinutes:    body.DailyLimitMinutes,
		AllowedFromMinute:    body.AllowedFromMinute,
		AllowedToMinute:      body.AllowedToMinute,
		MaxContentAge:        body.MaxContentAge,
		ApprovalMode:         body.ApprovalMode,
		AutodownloadWifiOnly: body.AutodownloadWifiOnly,
	})
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			httpkit.ValidationError(w, map[string][]string{"controls": {"مقادیر تنظیمات معتبر نیست"}})
			return
		}
		httpkit.Error(w, http.StatusNotFound, "not_found", "پروفایل یافت نشد")
		return
	}
	httpkit.JSON(w, http.StatusOK, controlsResponse(controls))
}

type pinBody struct {
	Pin string `json:"pin"`
}

func (h *Handler) setExitPin(w http.ResponseWriter, r *http.Request) {
	var body pinBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	if err := h.svc.SetExitPin(r.Context(), userID, chi.URLParam(r, "profileId"), body.Pin); err != nil {
		httpkit.ValidationError(w, map[string][]string{"pin": {"پین باید بین ۴ تا ۸ رقم باشد"}})
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) verifyExitPin(w http.ResponseWriter, r *http.Request) {
	var body pinBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}

	profileID := chi.URLParam(r, "profileId")
	userID, _ := httpkit.UserIDFromContext(r.Context())
	if _, err := h.svc.GetProfile(r.Context(), userID, profileID); err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "پروفایل یافت نشد")
		return
	}

	if err := h.svc.VerifyExitPin(r.Context(), profileID, body.Pin); err != nil {
		if errors.Is(err, ErrNoPinSet) {
			httpkit.Error(w, http.StatusConflict, "no_pin", "پینی تنظیم نشده است")
			return
		}
		httpkit.Error(w, http.StatusForbidden, "wrong_pin", "پین نادرست است")
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"verified": true})
}

func (h *Handler) listApprovals(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	approvals, err := h.svc.ListApprovals(r.Context(), userID, chi.URLParam(r, "profileId"))
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "پروفایل یافت نشد")
		return
	}
	out := make([]map[string]any, len(approvals))
	for i, a := range approvals {
		out[i] = map[string]any{
			"bookId": a.BookID, "decision": a.Decision, "title": a.BookTitle,
			"coverUrl": a.BookCoverURL, "decidedAt": a.DecidedAt,
		}
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"approvals": out})
}

func (h *Handler) setApproval(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Decision string `json:"decision"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	if err := h.svc.SetApproval(r.Context(), userID, chi.URLParam(r, "profileId"), chi.URLParam(r, "bookId"), body.Decision); err != nil {
		if errors.Is(err, ErrInvalidInput) {
			httpkit.ValidationError(w, map[string][]string{"decision": {"مقدار باید allow یا block باشد"}})
			return
		}
		httpkit.Error(w, http.StatusNotFound, "not_found", "پروفایل یافت نشد")
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) clearApproval(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	if err := h.svc.ClearApproval(r.Context(), userID, chi.URLParam(r, "profileId"), chi.URLParam(r, "bookId")); err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "پروفایل یافت نشد")
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) screenTime(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	st, err := h.svc.ScreenTime(r.Context(), userID, chi.URLParam(r, "profileId"))
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "پروفایل یافت نشد")
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{
		"secondsToday": st.SecondsToday, "remainingSeconds": st.RemainingSeconds,
		"withinAllowedHours": st.WithinHours,
	})
}

func (h *Handler) weeklyReport(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	report, err := h.svc.WeeklyReport(r.Context(), userID, chi.URLParam(r, "profileId"))
	if err != nil {
		h.log.ErrorContext(r.Context(), "kids: weekly report failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusNotFound, "not_found", "پروفایل یافت نشد")
		return
	}

	daily := make([]map[string]any, len(report.DailyBreakdown))
	for i, d := range report.DailyBreakdown {
		daily[i] = map[string]any{"date": d.Date.Format("2006-01-02"), "secondsListened": d.SecondsListened}
	}
	top := make([]map[string]any, len(report.TopBooks))
	for i, b := range report.TopBooks {
		top[i] = map[string]any{
			"bookId": b.BookID, "title": b.Title, "coverUrl": b.CoverURL,
			"secondsListened": b.SecondsListened,
		}
	}

	httpkit.JSON(w, http.StatusOK, map[string]any{
		"childProfileId": report.ChildProfileID, "displayName": report.DisplayName,
		"from": report.From, "to": report.To,
		"totalSeconds": report.TotalSeconds, "daysListened": report.DaysListened,
		"limitReachedDays": report.LimitReachedDays,
		"dailyBreakdown":   daily, "topBooks": top,
	})
}

func (h *Handler) listPrompts(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	prompts, err := h.svc.ListAllowedPrompts(r.Context(), userID, chi.URLParam(r, "profileId"))
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "پروفایل یافت نشد")
		return
	}

	// Only id and label go to the client. The prompt text stays on the
	// server: the child app sends an id, and nothing it can type ever
	// reaches the model.
	out := make([]map[string]any, len(prompts))
	for i, p := range prompts {
		out[i] = map[string]any{"id": p.ID, "label": p.Label}
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"prompts": out})
}

func profileResponse(p ChildProfile) map[string]any {
	return map[string]any{
		"id": p.ID, "displayName": p.DisplayName, "ageYears": p.AgeYears,
		"birthYear": p.BirthYear, "avatarKey": p.AvatarKey,
		"isActive": p.IsActive, "createdAt": p.CreatedAt,
	}
}

func controlsResponse(c Controls) map[string]any {
	return map[string]any{
		"dailyLimitMinutes":    c.DailyLimitMinutes,
		"allowedFromMinute":    c.AllowedFromMinute,
		"allowedToMinute":      c.AllowedToMinute,
		"maxContentAge":        c.MaxContentAge,
		"approvalMode":         c.ApprovalMode,
		"hasExitPin":           c.HasExitPin,
		"autodownloadWifiOnly": c.AutodownloadWifiOnly,
		"updatedAt":            c.UpdatedAt,
	}
}
