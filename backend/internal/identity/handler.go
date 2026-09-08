package identity

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"ketapod/internal/platform/httpkit"
)

var phoneNumberRe = regexp.MustCompile(`^09\d{9}$`)

// ChildProfileCounter lets /me/services know whether the parent has any
// child profile without identity importing the kids module's storage.
// cmd/api passes kids.Service; tests pass a stub.
type ChildProfileCounter interface {
	CountProfilesForParent(ctx context.Context, userID string) (int, error)
}

type Handler struct {
	svc  *Service
	kids ChildProfileCounter
	log  *slog.Logger
}

func NewHandler(svc *Service, kids ChildProfileCounter, log *slog.Logger) *Handler {
	return &Handler{svc: svc, kids: kids, log: log}
}

// Routes mounts the public auth endpoints directly and wraps the /me/*
// group with the authenticator — every module's handler.go is
// responsible for its own auth boundary; the router composition in
// cmd/api just mounts it.
func (h *Handler) Routes(r chi.Router, requireAuth func(http.Handler) http.Handler) {
	r.Post("/auth/otp/request", h.requestOTP)
	r.Post("/auth/otp/verify", h.verifyOTP)
	r.Post("/auth/token/refresh", h.refreshToken)
	r.Post("/auth/logout", h.logout)

	r.Group(func(r chi.Router) {
		r.Use(requireAuth)
		r.Get("/me", h.getMe)
		r.Patch("/me", h.updateMe)
		r.Put("/me/preferences/kids-mode", h.setKidsModePreference)
		r.Get("/me/services", h.getMyServices)
		r.Get("/me/devices", h.listDevices)
		r.Delete("/me/devices/{deviceId}", h.revokeDevice)
		r.Post("/me/logout-all", h.logoutAll)
	})
}

type otpRequestBody struct {
	PhoneNumber string `json:"phoneNumber"`
}

func (h *Handler) requestOTP(w http.ResponseWriter, r *http.Request) {
	var body otpRequestBody
	if err := httpkit.DecodeJSON(r, &body); err != nil || !phoneNumberRe.MatchString(body.PhoneNumber) {
		httpkit.Error(w, http.StatusUnprocessableEntity, "validation_error", "شماره موبایل معتبر نیست")
		return
	}

	if err := h.svc.RequestOTP(r.Context(), body.PhoneNumber, ClientIP(r)); err != nil {
		switch {
		case errors.Is(err, ErrRateLimited):
			httpkit.Error(w, http.StatusTooManyRequests, "rate_limited", "تعداد درخواست بیش از حد مجاز است")
		case errors.Is(err, ErrSuspended):
			httpkit.Error(w, http.StatusForbidden, "account_suspended", "حساب کاربری شما غیرفعال شده است")
		default:
			h.log.ErrorContext(r.Context(), "identity: request otp failed", slog.String("error", err.Error()))
			httpkit.Error(w, http.StatusInternalServerError, "error", "")
		}
		return
	}

	httpkit.JSON(w, http.StatusAccepted, map[string]string{"message": "کد تایید ارسال شد"})
}

type deviceInfoBody struct {
	Platform    string `json:"platform"`
	Name        string `json:"name"`
	PushToken   string `json:"pushToken"`
	AppVersion  string `json:"appVersion"`
	Fingerprint string `json:"fingerprint"`
}

type otpVerifyBody struct {
	PhoneNumber string          `json:"phoneNumber"`
	Code        string          `json:"code"`
	Device      *deviceInfoBody `json:"device"`
}

func (h *Handler) verifyOTP(w http.ResponseWriter, r *http.Request) {
	var body otpVerifyBody
	if err := httpkit.DecodeJSON(r, &body); err != nil || body.PhoneNumber == "" || body.Code == "" {
		httpkit.Error(w, http.StatusUnprocessableEntity, "validation_error", "شماره موبایل و کد الزامی است")
		return
	}

	var device *DeviceInfo
	if body.Device != nil {
		device = &DeviceInfo{
			Platform:    body.Device.Platform,
			Name:        body.Device.Name,
			PushToken:   body.Device.PushToken,
			AppVersion:  body.Device.AppVersion,
			Fingerprint: body.Device.Fingerprint,
		}
	}

	pair, err := h.svc.VerifyOTP(r.Context(), body.PhoneNumber, body.Code, device)
	if err != nil {
		if errors.Is(err, ErrSuspended) {
			httpkit.Error(w, http.StatusForbidden, "account_suspended", "حساب کاربری شما غیرفعال شده است")
			return
		}
		// Invalid code, expired code and exhausted attempts deliberately
		// share one response: distinguishing them tells an attacker which
		// phone numbers have a live OTP in flight.
		httpkit.Error(w, http.StatusUnauthorized, "unauthorized", "کد نامعتبر یا منقضی‌شده است")
		return
	}

	httpkit.JSON(w, http.StatusOK, toAuthTokenResponse(pair))
}

type refreshTokenBody struct {
	RefreshToken string `json:"refreshToken"`
}

func (h *Handler) refreshToken(w http.ResponseWriter, r *http.Request) {
	var body refreshTokenBody
	if err := httpkit.DecodeJSON(r, &body); err != nil || body.RefreshToken == "" {
		httpkit.Error(w, http.StatusUnprocessableEntity, "validation_error", "refreshToken الزامی است")
		return
	}

	pair, err := h.svc.RefreshToken(r.Context(), body.RefreshToken)
	if err != nil {
		if errors.Is(err, ErrTokenReplayed) {
			// The client must know this was not an ordinary expiry: every
			// session on this chain is gone and the user has to sign in
			// again with SMS.
			h.log.WarnContext(r.Context(), "identity: refresh token replay detected")
			httpkit.Error(w, http.StatusUnauthorized, "token_replayed", "به دلیل استفاده مجدد از توکن، همه نشست‌ها بسته شد. دوباره وارد شوید")
			return
		}
		httpkit.Error(w, http.StatusUnauthorized, "unauthorized", "refresh token نامعتبر یا باطل‌شده است")
		return
	}

	httpkit.JSON(w, http.StatusOK, toAuthTokenResponse(pair))
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	var body refreshTokenBody
	if err := httpkit.DecodeJSON(r, &body); err != nil || body.RefreshToken == "" {
		httpkit.Error(w, http.StatusUnprocessableEntity, "validation_error", "refreshToken الزامی است")
		return
	}

	if err := h.svc.Logout(r.Context(), body.RefreshToken); err != nil {
		h.log.ErrorContext(r.Context(), "identity: logout failed", slog.String("error", err.Error()))
	}
	httpkit.NoContent(w)
}

func (h *Handler) logoutAll(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	if err := h.svc.LogoutAll(r.Context(), userID); err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) getMe(w http.ResponseWriter, r *http.Request) {
	user, ok := UserFromContext(r.Context())
	if !ok {
		httpkit.Error(w, http.StatusUnauthorized, "unauthorized", "")
		return
	}
	httpkit.JSON(w, http.StatusOK, toUserResponse(user))
}

type updateMeBody struct {
	FullName *string `json:"fullName"`
	Email    *string `json:"email"`
}

func (h *Handler) updateMe(w http.ResponseWriter, r *http.Request) {
	var body updateMeBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}

	errs := map[string][]string{}
	if body.FullName != nil {
		*body.FullName = strings.TrimSpace(*body.FullName)
		if len([]rune(*body.FullName)) < 2 {
			errs["fullName"] = []string{"نام باید حداقل ۲ کاراکتر باشد"}
		}
	}
	if body.Email != nil && *body.Email != "" && !strings.Contains(*body.Email, "@") {
		errs["email"] = []string{"ایمیل معتبر نیست"}
	}
	if len(errs) > 0 {
		httpkit.ValidationError(w, errs)
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	user, err := h.svc.UpdateProfile(r.Context(), userID, ProfileUpdate{FullName: body.FullName, Email: body.Email})
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.JSON(w, http.StatusOK, toUserResponse(user))
}

type kidsModePreferenceBody struct {
	Enabled bool `json:"enabled"`
}

func (h *Handler) setKidsModePreference(w http.ResponseWriter, r *http.Request) {
	var body kidsModePreferenceBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.Error(w, http.StatusUnprocessableEntity, "validation_error", "enabled الزامی است")
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	if _, err := h.svc.SetKidsModePreference(r.Context(), userID, body.Enabled); err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	httpkit.JSON(w, http.StatusOK, body)
}

func (h *Handler) getMyServices(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())

	hasChildren := false
	if h.kids != nil {
		userID, _ := httpkit.UserIDFromContext(r.Context())
		if count, err := h.kids.CountProfilesForParent(r.Context(), userID); err == nil && count > 0 {
			hasChildren = true
		}
	}

	httpkit.JSON(w, http.StatusOK, map[string]any{"services": ServicesFor(user, hasChildren)})
}

func (h *Handler) listDevices(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	devices, err := h.svc.ListDevices(r.Context(), userID)
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	out := make([]map[string]any, len(devices))
	for i, d := range devices {
		out[i] = map[string]any{
			"id": d.ID, "platform": d.Platform, "name": d.Name,
			"appVersion": d.AppVersion, "lastActiveAt": d.LastActiveAt,
		}
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"devices": out})
}

func (h *Handler) revokeDevice(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	if err := h.svc.RevokeDevice(r.Context(), userID, chi.URLParam(r, "deviceId")); err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.NoContent(w)
}

// ClientIP prefers X-Forwarded-For's first hop. chi's RealIP middleware
// already rewrites RemoteAddr in cmd/api, so this is belt-and-braces for
// callers (tests, other modules) that construct requests directly.
func ClientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if idx := strings.IndexByte(fwd, ','); idx > 0 {
			return strings.TrimSpace(fwd[:idx])
		}
		return strings.TrimSpace(fwd)
	}
	host := r.RemoteAddr
	if idx := strings.LastIndexByte(host, ':'); idx > 0 {
		return host[:idx]
	}
	return host
}

func toUserResponse(u User) map[string]any {
	return map[string]any{
		"id":              u.ID,
		"phoneNumber":     u.PhoneNumber,
		"fullName":        u.FullName,
		"email":           u.Email,
		"role":            u.Role,
		"roles":           u.Roles,
		"status":          u.Status,
		"kidsModeEnabled": u.KidsModeEnabled,
		"createdAt":       u.CreatedAt,
	}
}

func toAuthTokenResponse(p TokenPair) map[string]any {
	return map[string]any{
		"accessToken":  p.AccessToken,
		"refreshToken": p.RefreshToken,
		"expiresIn":    p.ExpiresIn,
		"user":         toUserResponse(p.User),
	}
}
