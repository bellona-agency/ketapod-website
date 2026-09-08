package commerce

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// IsEntitledToEdition is the question media asks before serving bytes.
//
// Two independent grounds count:
//  1. an entitlement row — a purchase, a gift, an org seat;
//  2. an active subscription that still has hours left in the period.
//
// The subscription arm is not modelled as entitlement rows because a
// subscription covers the whole catalogue: writing one row per title
// would mean thousands of rows per subscriber and a backfill every time
// a book is published. Checking it here keeps that off disk and keeps
// the hour cap enforceable at the moment of playback.
func (s *Service) IsEntitledToEdition(ctx context.Context, userID, audioEditionID, bookID string) (bool, error) {
	if userID == "" {
		return false, nil
	}

	entitled, err := s.repo.IsUserEntitledToEdition(ctx, userID, audioEditionID, bookID)
	if err != nil {
		return false, fmt.Errorf("commerce: check entitlement: %w", err)
	}
	if entitled {
		return true, nil
	}

	sub, err := s.repo.GetActiveSubscription(ctx, userID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return false, nil
		}
		return false, fmt.Errorf("commerce: check subscription: %w", err)
	}
	return sub.HasCapacity(), nil
}

// IsEntitledToBook asks the weaker question: does the user hold access
// to *any* edition of this work. The book page uses it to decide whether
// to show "in your library"; playback always uses the edition-level
// check, because owning the calm narration does not grant the dramatic
// one — their prices are independent.
func (s *Service) IsEntitledToBook(ctx context.Context, userID, bookID string) (bool, error) {
	if userID == "" {
		return false, nil
	}
	entitled, err := s.repo.IsUserEntitledToBook(ctx, userID, bookID)
	if err != nil {
		return false, fmt.Errorf("commerce: check book entitlement: %w", err)
	}
	if entitled {
		return true, nil
	}

	sub, err := s.repo.GetActiveSubscription(ctx, userID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	return sub.HasCapacity(), nil
}

func (s *Service) ListEntitlements(ctx context.Context, userID string) ([]Entitlement, error) {
	entitlements, err := s.repo.ListActiveEntitlements(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("commerce: list entitlements: %w", err)
	}
	return entitlements, nil
}

// GrantOrgAccess is how school and university seats work: the same
// entitlement table with a different origin and an expiry
// (08-decisions.md — "org access is nothing but an Entitlement with a
// different origin"). Priced at zero it is also the free-schools
// programme, with no separate code path.
func (s *Service) GrantOrgAccess(ctx context.Context, userID, bookID string, expiresAt *time.Time, sourceReferenceID string) (Entitlement, error) {
	ent, err := s.repo.GrantEntitlement(ctx, userID, bookID, "", EntitlementOriginOrg, sourceReferenceID, expiresAt)
	if err != nil {
		return Entitlement{}, fmt.Errorf("commerce: grant org access: %w", err)
	}
	return ent, nil
}

// ---------- subscriptions ----------

func (s *Service) ListPlans(ctx context.Context) ([]SubscriptionPlan, error) {
	plans, err := s.repo.ListSubscriptionPlans(ctx)
	if err != nil {
		return nil, fmt.Errorf("commerce: list plans: %w", err)
	}
	return plans, nil
}

func (s *Service) ActiveSubscription(ctx context.Context, userID string) (Subscription, error) {
	return s.repo.GetActiveSubscription(ctx, userID)
}

// Subscribe charges the wallet, never a gateway directly. Iranian
// gateways have no working recurring payment, so renewal is "spend
// wallet credit" and the user tops the wallet up whenever they like —
// which removes the monthly churn point that a manual card payment
// creates (02-business.md).
func (s *Service) Subscribe(ctx context.Context, userID, planCode string, autoRenew bool) (Subscription, error) {
	plan, err := s.repo.GetSubscriptionPlanByCode(ctx, planCode)
	if err != nil {
		return Subscription{}, err
	}

	var subscription Subscription
	err = s.repo.InTx(ctx, func(tx Repository) error {
		existing, err := tx.GetActiveSubscription(ctx, userID)
		switch {
		case err == nil:
			// Already subscribed: extend rather than stack. Two
			// overlapping subscriptions would double-charge and make
			// "which hour cap applies" unanswerable.
			if plan.PriceIRR > 0 {
				if _, err := debitLocked(ctx, tx, userID, plan.PriceIRR, ReasonSubscription, "subscription", existing.ID); err != nil {
					return err
				}
			}
			if err := tx.ExtendSubscription(ctx, existing.ID, plan.PeriodDays); err != nil {
				return err
			}
			subscription, err = tx.GetActiveSubscription(ctx, userID)
			return err
		case errors.Is(err, ErrNotFound):
		default:
			return err
		}

		created, err := tx.CreateSubscription(ctx, userID, plan.ID,
			time.Now().Add(time.Duration(plan.PeriodDays)*24*time.Hour), autoRenew)
		if err != nil {
			return fmt.Errorf("commerce: create subscription: %w", err)
		}

		if plan.PriceIRR > 0 {
			if _, err := debitLocked(ctx, tx, userID, plan.PriceIRR, ReasonSubscription, "subscription", created.ID); err != nil {
				return err
			}
		}

		created.Plan = &plan
		subscription = created
		return nil
	})
	if err != nil {
		return Subscription{}, err
	}

	return subscription, nil
}

func (s *Service) CancelSubscription(ctx context.Context, userID, subscriptionID string) error {
	return s.repo.CancelSubscription(ctx, subscriptionID, userID)
}

// RecordSubscriptionUsage is called from the listening-event path. It is
// what makes the hour cap real: without it "45 hours a month" is a
// marketing line rather than a limit.
func (s *Service) RecordSubscriptionUsage(ctx context.Context, userID string, seconds int64) error {
	if seconds <= 0 {
		return nil
	}
	sub, err := s.repo.GetActiveSubscription(ctx, userID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil
		}
		return err
	}
	return s.repo.AddSubscriptionHours(ctx, sub.ID, float64(seconds)/3600)
}

// ExpireDueSubscriptions is the scheduler's job. Expiry has to be a
// sweep and not only a lazy check, because the weekly report, renewal
// reminder and analytics all read status.
func (s *Service) ExpireDueSubscriptions(ctx context.Context) (int, error) {
	return s.repo.ExpireDueSubscriptions(ctx)
}

// DefaultRenewalWindow is the recovery policy for the renewal sweep.
//
// GraceHours is the part that matters. The sweep used to look only one
// hour ahead at rows still marked 'active' — so if the worker was down,
// or if the expiry sweep simply ran first, an auto-renewing subscription
// slipped past it and lapsed silently. Nobody found out until the user
// complained. A grace window means a missed run is caught by the next
// one instead of being lost.
var DefaultRenewalWindow = RenewalWindow{
	LookaheadHours:  1,
	GraceHours:      72,
	RetryAfterHours: 6,
}

// RenewalWindow bounds which subscriptions a renewal sweep picks up.
type RenewalWindow struct {
	// LookaheadHours renews slightly early. Charging days early would be
	// indistinguishable from a bug to the user.
	LookaheadHours int
	// GraceHours reaches backwards to catch renewals a missed run left
	// behind, including ones already marked expired.
	GraceHours int
	// RetryAfterHours stops an hourly sweep from poking an empty wallet
	// sixty times a day and drowning the log.
	RetryAfterHours int
}

// ReconcileSubscriptions renews what is due and then expires what is
// genuinely over.
//
// The two run in one function on purpose. As two independent scheduled
// jobs they raced: whichever fired first decided whether a due
// subscription got renewed or expired, and the expiry path was
// unrecoverable. Ordering them inside a single handler removes the race
// entirely rather than hoping the scheduler fires them in a helpful
// order.
func (s *Service) ReconcileSubscriptions(ctx context.Context, window RenewalWindow) (ReconcileResult, error) {
	var result ReconcileResult

	due, err := s.repo.ListSubscriptionsDueForRenewal(ctx, window)
	if err != nil {
		return result, fmt.Errorf("commerce: list renewals due: %w", err)
	}

	for _, sub := range due {
		err := s.renewOne(ctx, sub)

		// The attempt is recorded either way, so a wallet that cannot
		// pay is backed off instead of retried every hour.
		if markErr := s.repo.MarkRenewalAttempt(ctx, sub.ID, err == nil); markErr != nil {
			return result, fmt.Errorf("commerce: mark renewal attempt: %w", markErr)
		}

		switch {
		case err == nil:
			result.Renewed++
		case errors.Is(err, ErrInsufficientFunds):
			// A normal outcome in a pay-as-you-go market, not an error:
			// the subscription lapses and the reminder tells the user to
			// top up.
			result.InsufficientFunds++
		default:
			result.Failed++
			result.LastError = err
		}
	}

	expired, err := s.repo.ExpireDueSubscriptions(ctx)
	if err != nil {
		return result, fmt.Errorf("commerce: expire subscriptions: %w", err)
	}
	result.Expired = expired

	return result, nil
}

type ReconcileResult struct {
	Renewed           int
	InsufficientFunds int
	Failed            int
	Expired           int
	LastError         error
}

func (s *Service) renewOne(ctx context.Context, sub Subscription) error {
	return s.repo.InTx(ctx, func(tx Repository) error {
		current, err := tx.GetSubscriptionByID(ctx, sub.ID)
		if err != nil {
			return err
		}
		if current.Plan == nil {
			return ErrNotFound
		}
		if current.Plan.PriceIRR > 0 {
			if _, err := debitLocked(ctx, tx, current.UserID, current.Plan.PriceIRR,
				ReasonSubscription, "subscription", current.ID); err != nil {
				return err
			}
		}
		if err := tx.ExtendSubscription(ctx, current.ID, current.Plan.PeriodDays); err != nil {
			return err
		}
		// A subscription renewed out of the grace window is still marked
		// expired. Without this the user has paid and still has no
		// access, which is the worst of both outcomes.
		return tx.ReactivateSubscription(ctx, current.ID)
	})
}

// ---------- refunds ----------

// RequestRefund encodes the money-back guarantee as a rule rather than a
// judgement call: inside the window, and only if the buyer has heard
// less than the threshold. Support staff can still approve an
// out-of-policy refund by crediting the wallet directly; this path is
// the one the user drives.
func (s *Service) RequestRefund(ctx context.Context, userID, orderID, reason string) (Refund, error) {
	order, err := s.repo.GetOrderByID(ctx, orderID)
	if err != nil {
		return Refund{}, err
	}
	if order.UserID != userID {
		return Refund{}, ErrNotFound
	}
	if order.Status != OrderPaid {
		return Refund{}, ErrRefundNotEligible
	}
	if time.Since(order.CreatedAt) > RefundWindow {
		return Refund{}, ErrRefundNotEligible
	}

	if s.listening != nil {
		for _, item := range order.Items {
			seconds, err := s.listening.SecondsListenedForEdition(ctx, userID, item.AudioEditionID)
			if err != nil {
				return Refund{}, fmt.Errorf("commerce: read listening for refund: %w", err)
			}
			edition, err := s.editions.GetEdition(ctx, item.AudioEditionID)
			if err != nil {
				return Refund{}, err
			}
			if edition.DurationSeconds > 0 &&
				float64(seconds)/float64(edition.DurationSeconds) > RefundMaxListenedRatio {
				return Refund{}, ErrRefundNotEligible
			}
		}
	}

	refund, err := s.repo.CreateRefund(ctx, order.ID, userID, order.TotalIRR, reason)
	if err != nil {
		return Refund{}, fmt.Errorf("commerce: create refund: %w", err)
	}
	return refund, nil
}

// ApproveRefund credits the wallet rather than reversing to the card.
// Iranian gateway reversals are slow and manual; wallet credit is
// instant, keeps the money inside the product, and — because the ledger
// is append-only — leaves both the original debit and the compensating
// credit visible for audit.
func (s *Service) ApproveRefund(ctx context.Context, adminUserID, refundID string) (Refund, error) {
	var resolved Refund
	err := s.repo.InTx(ctx, func(tx Repository) error {
		refund, err := tx.GetRefundByID(ctx, refundID)
		if err != nil {
			return err
		}

		resolved, err = tx.ResolveRefund(ctx, refundID, "approved", adminUserID)
		if err != nil {
			return err
		}

		if refund.AmountIRR > 0 {
			if _, err := tx.CreateWalletLedgerEntry(ctx, refund.UserID, EntryTypeCredit,
				refund.AmountIRR, ReasonRefund, "refund", refund.ID); err != nil {
				return fmt.Errorf("commerce: credit refund: %w", err)
			}
		}

		if err := tx.RevokeEntitlementsForOrder(ctx, refund.OrderID); err != nil {
			return fmt.Errorf("commerce: revoke entitlements on refund: %w", err)
		}
		return tx.MarkOrderRefunded(ctx, refund.OrderID)
	})
	if err != nil {
		return Refund{}, err
	}
	return resolved, nil
}

func (s *Service) RejectRefund(ctx context.Context, adminUserID, refundID string) (Refund, error) {
	return s.repo.ResolveRefund(ctx, refundID, "rejected", adminUserID)
}
