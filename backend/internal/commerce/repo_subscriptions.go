package commerce

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"ketapod/internal/commerce/sqlcgen"
)

func (r *pgRepo) ListSubscriptionPlans(ctx context.Context) ([]SubscriptionPlan, error) {
	rows, err := r.q.ListActiveSubscriptionPlans(ctx)
	if err != nil {
		return nil, err
	}
	plans := make([]SubscriptionPlan, len(rows))
	for i, row := range rows {
		plans[i] = toPlan(row)
	}
	return plans, nil
}

func (r *pgRepo) GetSubscriptionPlanByCode(ctx context.Context, code string) (SubscriptionPlan, error) {
	row, err := r.q.GetSubscriptionPlanByCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SubscriptionPlan{}, ErrNotFound
		}
		return SubscriptionPlan{}, err
	}
	return toPlan(row), nil
}

// GetActiveSubscription hydrates the plan alongside the subscription:
// every caller that cares about a subscription at all also needs the
// hour cap to decide whether it still grants access, and splitting the
// two guarantees somebody eventually checks status without checking
// capacity.
func (r *pgRepo) GetActiveSubscription(ctx context.Context, userID string) (Subscription, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return Subscription{}, fmt.Errorf("commerce: parse user id: %w", err)
	}
	row, err := r.q.GetActiveSubscriptionForUser(ctx, parsedID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Subscription{}, ErrNotFound
		}
		return Subscription{}, err
	}

	sub := toSubscription(row)
	if planRow, err := r.q.GetSubscriptionPlanByID(ctx, row.PlanID); err == nil {
		plan := toPlan(planRow)
		sub.Plan = &plan
	}
	return sub, nil
}

func (r *pgRepo) CreateSubscription(ctx context.Context, userID, planID string, expiresAt time.Time, autoRenew bool) (Subscription, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return Subscription{}, fmt.Errorf("commerce: parse user id: %w", err)
	}
	planUUID, err := uuid.Parse(planID)
	if err != nil {
		return Subscription{}, fmt.Errorf("commerce: parse plan id: %w", err)
	}
	row, err := r.q.CreateSubscription(ctx, sqlcgen.CreateSubscriptionParams{
		UserID: userUUID, PlanID: planUUID, ExpiresAt: expiresAt, AutoRenewFromWallet: autoRenew,
	})
	if err != nil {
		return Subscription{}, err
	}
	return toSubscription(row), nil
}

func (r *pgRepo) ExtendSubscription(ctx context.Context, subscriptionID string, days int) error {
	parsedID, err := uuid.Parse(subscriptionID)
	if err != nil {
		return fmt.Errorf("commerce: parse subscription id: %w", err)
	}
	_, err = r.q.ExtendSubscription(ctx, sqlcgen.ExtendSubscriptionParams{
		ID: parsedID, Column2: int32(days),
	})
	return err
}

func (r *pgRepo) CancelSubscription(ctx context.Context, subscriptionID, userID string) error {
	subUUID, err := uuid.Parse(subscriptionID)
	if err != nil {
		return fmt.Errorf("commerce: parse subscription id: %w", err)
	}
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return fmt.Errorf("commerce: parse user id: %w", err)
	}
	if _, err := r.q.CancelSubscription(ctx, sqlcgen.CancelSubscriptionParams{
		ID: subUUID, UserID: userUUID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

func (r *pgRepo) AddSubscriptionHours(ctx context.Context, subscriptionID string, hours float64) error {
	parsedID, err := uuid.Parse(subscriptionID)
	if err != nil {
		return fmt.Errorf("commerce: parse subscription id: %w", err)
	}
	_, err = r.q.AddSubscriptionHours(ctx, sqlcgen.AddSubscriptionHoursParams{
		ID: parsedID, HoursConsumed: floatToNumeric(hours),
	})
	return err
}

func (r *pgRepo) ExpireDueSubscriptions(ctx context.Context) (int, error) {
	rows, err := r.q.ExpireDueSubscriptions(ctx)
	if err != nil {
		return 0, err
	}
	return len(rows), nil
}

func (r *pgRepo) ListSubscriptionsDueForRenewal(ctx context.Context, window RenewalWindow) ([]Subscription, error) {
	rows, err := r.q.ListSubscriptionsDueForRenewal(ctx, sqlcgen.ListSubscriptionsDueForRenewalParams{
		LookaheadHours:  int32(window.LookaheadHours),
		GraceHours:      int32(window.GraceHours),
		RetryAfterHours: int32(window.RetryAfterHours),
	})
	if err != nil {
		return nil, err
	}
	subs := make([]Subscription, len(rows))
	for i, row := range rows {
		subs[i] = toSubscription(row)
		if planRow, err := r.q.GetSubscriptionPlanByID(ctx, row.PlanID); err == nil {
			plan := toPlan(planRow)
			subs[i].Plan = &plan
		}
	}
	return subs, nil
}

func (r *pgRepo) MarkRenewalAttempt(ctx context.Context, subscriptionID string, succeeded bool) error {
	parsedID, err := uuid.Parse(subscriptionID)
	if err != nil {
		return fmt.Errorf("commerce: parse subscription id: %w", err)
	}
	return r.q.MarkRenewalAttempt(ctx, sqlcgen.MarkRenewalAttemptParams{
		ID: parsedID, Succeeded: succeeded,
	})
}

func (r *pgRepo) ReactivateSubscription(ctx context.Context, subscriptionID string) error {
	parsedID, err := uuid.Parse(subscriptionID)
	if err != nil {
		return fmt.Errorf("commerce: parse subscription id: %w", err)
	}
	return r.q.ReactivateSubscription(ctx, parsedID)
}

func (r *pgRepo) GetSubscriptionByID(ctx context.Context, subscriptionID string) (Subscription, error) {
	parsedID, err := uuid.Parse(subscriptionID)
	if err != nil {
		return Subscription{}, ErrNotFound
	}
	row, err := r.q.GetSubscriptionByID(ctx, parsedID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Subscription{}, ErrNotFound
		}
		return Subscription{}, err
	}
	sub := toSubscription(row)
	if planRow, err := r.q.GetSubscriptionPlanByID(ctx, row.PlanID); err == nil {
		plan := toPlan(planRow)
		sub.Plan = &plan
	}
	return sub, nil
}

func (r *pgRepo) CreateRefund(ctx context.Context, orderID, userID string, amountIRR int64, reason string) (Refund, error) {
	orderUUID, err := uuid.Parse(orderID)
	if err != nil {
		return Refund{}, fmt.Errorf("commerce: parse order id: %w", err)
	}
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return Refund{}, fmt.Errorf("commerce: parse user id: %w", err)
	}
	row, err := r.q.CreateRefund(ctx, sqlcgen.CreateRefundParams{
		OrderID: orderUUID, UserID: userUUID, AmountIrr: amountIRR, Reason: nullableString(reason),
	})
	if err != nil {
		return Refund{}, err
	}
	return toRefund(row), nil
}

func (r *pgRepo) GetRefundByID(ctx context.Context, refundID string) (Refund, error) {
	parsedID, err := uuid.Parse(refundID)
	if err != nil {
		return Refund{}, ErrNotFound
	}
	row, err := r.q.GetRefundByID(ctx, parsedID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Refund{}, ErrNotFound
		}
		return Refund{}, err
	}
	return toRefund(row), nil
}

func (r *pgRepo) ResolveRefund(ctx context.Context, refundID, status, resolvedBy string) (Refund, error) {
	refundUUID, err := uuid.Parse(refundID)
	if err != nil {
		return Refund{}, ErrNotFound
	}
	resolver, err := toPgUUID(resolvedBy)
	if err != nil {
		return Refund{}, fmt.Errorf("commerce: parse resolver id: %w", err)
	}
	row, err := r.q.ResolveRefund(ctx, sqlcgen.ResolveRefundParams{
		ID: refundUUID, Status: status, ResolvedBy: resolver,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Refund{}, ErrRefundAlreadyResolved
		}
		return Refund{}, err
	}
	return toRefund(row), nil
}

func (r *pgRepo) ListRefundsForOrder(ctx context.Context, orderID string) ([]Refund, error) {
	parsedID, err := uuid.Parse(orderID)
	if err != nil {
		return nil, ErrNotFound
	}
	rows, err := r.q.ListRefundsForOrder(ctx, parsedID)
	if err != nil {
		return nil, err
	}
	refunds := make([]Refund, len(rows))
	for i, row := range rows {
		refunds[i] = toRefund(row)
	}
	return refunds, nil
}

func toPlan(row sqlcgen.CommerceSubscriptionPlan) SubscriptionPlan {
	return SubscriptionPlan{
		ID: row.ID.String(), Code: row.Code, Name: row.Name,
		PriceIRR: row.PriceIrr, PeriodDays: int(row.PeriodDays),
		MonthlyHourCap: int(row.MonthlyHourCap),
	}
}

func toSubscription(row sqlcgen.CommerceSubscription) Subscription {
	return Subscription{
		ID: row.ID.String(), UserID: row.UserID.String(), PlanID: row.PlanID.String(),
		Status: row.Status, AutoRenewFromWallet: row.AutoRenewFromWallet,
		StartedAt: row.StartedAt, ExpiresAt: row.ExpiresAt,
		HoursConsumed: numericToFloat(row.HoursConsumed),
	}
}

func toRefund(row sqlcgen.CommerceRefund) Refund {
	return Refund{
		ID: row.ID.String(), OrderID: row.OrderID.String(), UserID: row.UserID.String(),
		AmountIRR: row.AmountIrr, Reason: stringOrEmpty(row.Reason), Status: row.Status,
		RequestedAt: row.RequestedAt, ResolvedAt: fromPgTimestamptz(row.ResolvedAt),
	}
}

func numericToFloat(n pgtype.Numeric) float64 {
	if !n.Valid || n.NaN {
		return 0
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return 0
	}
	return f.Float64
}

func floatToNumeric(f float64) pgtype.Numeric {
	var n pgtype.Numeric
	if err := n.Scan(big.NewFloat(f).Text('f', 6)); err != nil {
		return pgtype.Numeric{Valid: false}
	}
	return n
}
