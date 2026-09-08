package commerce

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"ketapod/internal/platform/httpkit"
)

type Handler struct {
	svc         *Service
	callbackURL string
	log         *slog.Logger
}

func NewHandler(svc *Service, callbackURL string, log *slog.Logger) *Handler {
	return &Handler{svc: svc, callbackURL: callbackURL, log: log}
}

func (h *Handler) Routes(r chi.Router, requireAuth, requireAdmin func(http.Handler) http.Handler) {
	// The gateway callback is unauthenticated by necessity: the user
	// returns from the bank, not from the app, and carries no token. It
	// is safe because settlement re-verifies with the provider
	// server-side and is idempotent — the callback is a hint that
	// something happened, never evidence of payment.
	r.Get("/payments/callback", h.paymentCallback)
	r.Get("/public/subscription-plans", h.listPlans)

	r.Group(func(r chi.Router) {
		r.Use(requireAuth)

		r.Get("/me/wallet", h.getWallet)
		r.Get("/me/wallet/ledger", h.getLedger)
		r.Post("/me/wallet/topup", h.startTopUp)

		r.Post("/me/orders", h.purchase)
		r.Get("/me/orders", h.listOrders)
		r.Get("/me/orders/{orderId}", h.getOrder)
		r.Post("/me/orders/{orderId}/refund", h.requestRefund)

		r.Post("/me/coupons/preview", h.previewCoupon)

		r.Get("/me/entitlements", h.listEntitlements)

		r.Get("/me/subscription", h.getSubscription)
		r.Post("/me/subscription", h.subscribe)
		r.Delete("/me/subscription", h.cancelSubscription)
	})

	r.Group(func(r chi.Router) {
		r.Use(requireAuth)
		r.Use(requireAdmin)
		r.Post("/admin/refunds/{refundId}/approve", h.approveRefund)
		r.Post("/admin/refunds/{refundId}/reject", h.rejectRefund)
	})
}

func (h *Handler) getWallet(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	balance, err := h.svc.Balance(r.Context(), userID)
	if err != nil {
		h.log.ErrorContext(r.Context(), "commerce: balance failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"balanceIrr": balance})
}

func (h *Handler) getLedger(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	page := httpkit.PageFromRequest(r)

	entries, total, err := h.svc.LedgerHistory(r.Context(), userID, page.Limit, page.Offset)
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	out := make([]map[string]any, len(entries))
	for i, e := range entries {
		out[i] = map[string]any{
			"id": e.ID, "type": e.EntryType, "amountIrr": e.AmountIRR,
			"reason": e.Reason, "referenceType": e.ReferenceType,
			"referenceId": e.ReferenceID, "createdAt": e.CreatedAt,
		}
	}
	httpkit.Page200(w, out, total, page)
}

type topUpBody struct {
	AmountIRR int64  `json:"amountIrr"`
	Mobile    string `json:"mobile"`
}

func (h *Handler) startTopUp(w http.ResponseWriter, r *http.Request) {
	var body topUpBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	result, err := h.svc.StartTopUp(r.Context(), userID, body.AmountIRR, h.callbackURL, body.Mobile)
	if err != nil {
		if errors.Is(err, ErrAmountInvalid) {
			httpkit.ValidationError(w, map[string][]string{"amountIrr": {"مبلغ شارژ معتبر نیست"}})
			return
		}
		h.log.ErrorContext(r.Context(), "commerce: start topup failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusBadGateway, "payment_gateway_error", "اتصال به درگاه پرداخت ممکن نشد")
		return
	}

	httpkit.JSON(w, http.StatusCreated, map[string]any{
		"paymentId": result.PaymentID, "redirectUrl": result.RedirectURL, "authority": result.Authority,
	})
}

func (h *Handler) paymentCallback(w http.ResponseWriter, r *http.Request) {
	authority := r.URL.Query().Get("authority")
	if authority == "" {
		authority = r.URL.Query().Get("Authority")
	}
	provider := r.URL.Query().Get("provider")
	if provider == "" {
		provider = h.svc.provider.Name()
	}

	payment, err := h.svc.SettleTopUp(r.Context(), provider, authority)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpkit.Error(w, http.StatusNotFound, "not_found", "تراکنش یافت نشد")
			return
		}
		httpkit.JSON(w, http.StatusPaymentRequired, map[string]any{"status": "failed"})
		return
	}

	httpkit.JSON(w, http.StatusOK, map[string]any{
		"status": "succeeded", "paymentId": payment.ID,
		"amountIrr": payment.AmountIRR, "referenceCode": payment.ReferenceCode,
	})
}

type purchaseLineBody struct {
	AudioEditionID  string `json:"audioEditionId"`
	RecipientUserID string `json:"recipientUserId"`
	GiftMessage     string `json:"giftMessage"`
}

type purchaseBody struct {
	Items          []purchaseLineBody `json:"items"`
	CouponCode     string             `json:"couponCode"`
	IdempotencyKey string             `json:"idempotencyKey"`
}

func (h *Handler) purchase(w http.ResponseWriter, r *http.Request) {
	var body purchaseBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}
	if len(body.Items) == 0 {
		httpkit.ValidationError(w, map[string][]string{"items": {"حداقل یک مورد لازم است"}})
		return
	}

	lines := make([]PurchaseLine, len(body.Items))
	for i, item := range body.Items {
		lines[i] = PurchaseLine{
			AudioEditionID:  item.AudioEditionID,
			RecipientUserID: item.RecipientUserID,
			GiftMessage:     item.GiftMessage,
		}
	}

	// The idempotency key may also arrive as a header, which is what
	// generated HTTP clients tend to set automatically on retry.
	key := body.IdempotencyKey
	if key == "" {
		key = r.Header.Get("Idempotency-Key")
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	result, err := h.svc.Purchase(r.Context(), userID, lines, body.CouponCode, key)
	if err != nil {
		switch {
		case errors.Is(err, ErrInsufficientFunds):
			httpkit.Error(w, http.StatusPaymentRequired, "insufficient_funds", "موجودی کیف پول کافی نیست")
		case errors.Is(err, ErrAlreadyOwned):
			httpkit.Error(w, http.StatusConflict, "already_owned", "این نسخه را قبلاً خریده‌اید")
		case errors.Is(err, ErrCouponNotFound), errors.Is(err, ErrCouponNotUsable):
			httpkit.ValidationError(w, map[string][]string{"couponCode": {"کد تخفیف معتبر نیست"}})
		case errors.Is(err, ErrNotFound):
			httpkit.Error(w, http.StatusNotFound, "not_found", "نسخه صوتی یافت نشد")
		default:
			h.log.ErrorContext(r.Context(), "commerce: purchase failed", slog.String("error", err.Error()))
			httpkit.Error(w, http.StatusInternalServerError, "error", "")
		}
		return
	}

	status := http.StatusCreated
	if result.Reused {
		status = http.StatusOK
	}
	httpkit.JSON(w, status, orderResponse(result.Order))
}

func (h *Handler) listOrders(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	page := httpkit.PageFromRequest(r)

	orders, total, err := h.svc.ListOrders(r.Context(), userID, page.Limit, page.Offset)
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	out := make([]map[string]any, len(orders))
	for i, o := range orders {
		out[i] = orderResponse(o)
	}
	httpkit.Page200(w, out, total, page)
}

func (h *Handler) getOrder(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	order, err := h.svc.GetOrder(r.Context(), userID, chi.URLParam(r, "orderId"))
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "سفارش یافت نشد")
		return
	}
	httpkit.JSON(w, http.StatusOK, orderResponse(order))
}

type couponPreviewBody struct {
	Code        string `json:"code"`
	SubtotalIRR int64  `json:"subtotalIrr"`
}

func (h *Handler) previewCoupon(w http.ResponseWriter, r *http.Request) {
	var body couponPreviewBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	discount, err := h.svc.PreviewCoupon(r.Context(), userID, body.Code, body.SubtotalIRR)
	if err != nil {
		httpkit.JSON(w, http.StatusOK, map[string]any{"valid": false, "discountIrr": 0})
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{
		"valid": true, "discountIrr": discount, "totalIrr": body.SubtotalIRR - discount,
	})
}

func (h *Handler) listEntitlements(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	entitlements, err := h.svc.ListEntitlements(r.Context(), userID)
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	out := make([]map[string]any, len(entitlements))
	for i, e := range entitlements {
		out[i] = map[string]any{
			"id": e.ID, "bookId": e.BookID, "audioEditionId": e.AudioEditionID,
			"origin": e.Origin, "grantedAt": e.GrantedAt, "expiresAt": e.ExpiresAt,
		}
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"entitlements": out})
}

func (h *Handler) listPlans(w http.ResponseWriter, r *http.Request) {
	plans, err := h.svc.ListPlans(r.Context())
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	out := make([]map[string]any, len(plans))
	for i, p := range plans {
		out[i] = map[string]any{
			"id": p.ID, "code": p.Code, "name": p.Name, "priceIrr": p.PriceIRR,
			"periodDays": p.PeriodDays, "monthlyHourCap": p.MonthlyHourCap,
		}
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"plans": out})
}

func (h *Handler) getSubscription(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	sub, err := h.svc.ActiveSubscription(r.Context(), userID)
	if err != nil {
		httpkit.JSON(w, http.StatusOK, map[string]any{"subscription": nil})
		return
	}

	body := map[string]any{
		"id": sub.ID, "status": sub.Status, "expiresAt": sub.ExpiresAt,
		"hoursConsumed": sub.HoursConsumed, "autoRenewFromWallet": sub.AutoRenewFromWallet,
		"hasCapacity": sub.HasCapacity(),
	}
	if sub.Plan != nil {
		body["plan"] = map[string]any{
			"code": sub.Plan.Code, "name": sub.Plan.Name,
			"priceIrr": sub.Plan.PriceIRR, "monthlyHourCap": sub.Plan.MonthlyHourCap,
		}
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"subscription": body})
}

type subscribeBody struct {
	PlanCode  string `json:"planCode"`
	AutoRenew bool   `json:"autoRenew"`
}

func (h *Handler) subscribe(w http.ResponseWriter, r *http.Request) {
	var body subscribeBody
	if err := httpkit.DecodeJSON(r, &body); err != nil || body.PlanCode == "" {
		httpkit.ValidationError(w, map[string][]string{"planCode": {"این فیلد الزامی است"}})
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	sub, err := h.svc.Subscribe(r.Context(), userID, body.PlanCode, body.AutoRenew)
	if err != nil {
		switch {
		case errors.Is(err, ErrInsufficientFunds):
			httpkit.Error(w, http.StatusPaymentRequired, "insufficient_funds", "موجودی کیف پول کافی نیست")
		case errors.Is(err, ErrNotFound):
			httpkit.Error(w, http.StatusNotFound, "not_found", "پلن یافت نشد")
		default:
			h.log.ErrorContext(r.Context(), "commerce: subscribe failed", slog.String("error", err.Error()))
			httpkit.Error(w, http.StatusInternalServerError, "error", "")
		}
		return
	}

	httpkit.JSON(w, http.StatusCreated, map[string]any{
		"id": sub.ID, "status": sub.Status, "expiresAt": sub.ExpiresAt,
	})
}

func (h *Handler) cancelSubscription(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	sub, err := h.svc.ActiveSubscription(r.Context(), userID)
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "اشتراک فعالی ندارید")
		return
	}
	if err := h.svc.CancelSubscription(r.Context(), userID, sub.ID); err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.NoContent(w)
}

type refundBody struct {
	Reason string `json:"reason"`
}

func (h *Handler) requestRefund(w http.ResponseWriter, r *http.Request) {
	var body refundBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	refund, err := h.svc.RequestRefund(r.Context(), userID, chi.URLParam(r, "orderId"), body.Reason)
	if err != nil {
		switch {
		case errors.Is(err, ErrRefundNotEligible):
			httpkit.Error(w, http.StatusConflict, "not_eligible", "این سفارش مشمول بازگشت وجه نیست")
		case errors.Is(err, ErrNotFound):
			httpkit.Error(w, http.StatusNotFound, "not_found", "سفارش یافت نشد")
		default:
			httpkit.Error(w, http.StatusInternalServerError, "error", "")
		}
		return
	}

	httpkit.JSON(w, http.StatusCreated, map[string]any{
		"id": refund.ID, "status": refund.Status, "amountIrr": refund.AmountIRR,
	})
}

func (h *Handler) approveRefund(w http.ResponseWriter, r *http.Request) {
	adminID, _ := httpkit.UserIDFromContext(r.Context())
	refund, err := h.svc.ApproveRefund(r.Context(), adminID, chi.URLParam(r, "refundId"))
	if err != nil {
		if errors.Is(err, ErrRefundAlreadyResolved) {
			httpkit.Error(w, http.StatusConflict, "already_resolved", "این درخواست قبلاً بررسی شده است")
			return
		}
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"id": refund.ID, "status": refund.Status})
}

func (h *Handler) rejectRefund(w http.ResponseWriter, r *http.Request) {
	adminID, _ := httpkit.UserIDFromContext(r.Context())
	refund, err := h.svc.RejectRefund(r.Context(), adminID, chi.URLParam(r, "refundId"))
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"id": refund.ID, "status": refund.Status})
}

func orderResponse(o Order) map[string]any {
	items := make([]map[string]any, len(o.Items))
	for i, item := range o.Items {
		items[i] = map[string]any{
			"id": item.ID, "audioEditionId": item.AudioEditionID, "bookId": item.BookID,
			"unitPriceIrr": item.UnitPriceIRR, "recipientUserId": item.RecipientUserID,
		}
	}
	return map[string]any{
		"id": o.ID, "status": o.Status, "subtotalIrr": o.SubtotalIRR,
		"discountIrr": o.DiscountIRR, "totalIrr": o.TotalIRR,
		"createdAt": o.CreatedAt, "paidAt": o.PaidAt, "items": items,
	}
}
