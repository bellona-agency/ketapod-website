package commerce

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"ketapod/internal/catalog"
)

var (
	ErrNotFound              = errors.New("commerce: not found")
	ErrInsufficientFunds     = errors.New("commerce: insufficient wallet balance")
	ErrAlreadyOwned          = errors.New("commerce: edition already owned")
	ErrCouponNotFound        = errors.New("commerce: coupon not found")
	ErrCouponNotUsable       = errors.New("commerce: coupon not usable")
	ErrPaymentAlreadySettled = errors.New("commerce: payment already settled")
	ErrRefundAlreadyResolved = errors.New("commerce: refund already resolved")
	ErrRefundNotEligible     = errors.New("commerce: order not eligible for refund")
	ErrEmptyPurchase         = errors.New("commerce: purchase has no lines")
	ErrAmountInvalid         = errors.New("commerce: amount must be positive")
)

// Refund policy. Both numbers are business decisions, not technical
// ones, and they live here so all three clients get the same answer:
// a refund is possible for a week, and only while the buyer has heard
// little enough that they plausibly did not consume the product.
const (
	RefundWindow           = 7 * 24 * time.Hour
	RefundMaxListenedRatio = 0.20
	minTopUpIRR            = 10_000
	maxTopUpIRR            = 50_000_000
)

// Repository is what the commerce services need from storage. repo.go
// and repo_subscriptions.go implement it against sqlc-generated code.
type Repository interface {
	InTx(ctx context.Context, fn func(Repository) error) error

	LockWallet(ctx context.Context, userID string) error
	CreateWalletLedgerEntry(ctx context.Context, userID string, entryType EntryType, amountIRR int64, reason, referenceType, referenceID string) (WalletLedgerEntry, error)
	GetWalletBalance(ctx context.Context, userID string) (int64, error)
	ListWalletLedger(ctx context.Context, userID string, limit, offset int32) ([]WalletLedgerEntry, int64, error)

	CreatePayment(ctx context.Context, userID, provider string, amountIRR int64, authority string) (Payment, error)
	GetPaymentByAuthority(ctx context.Context, provider, authority string) (Payment, error)
	LockPaymentForSettlement(ctx context.Context, paymentID string) (Payment, error)
	MarkPaymentSucceeded(ctx context.Context, paymentID, referenceCode, ledgerEntryID string) (Payment, error)
	MarkPaymentFailed(ctx context.Context, paymentID, reason string) error

	CreateOrder(ctx context.Context, userID string, subtotal, discount, total int64, couponID, idempotencyKey string) (Order, error)
	GetOrderByID(ctx context.Context, orderID string) (Order, error)
	GetOrderByIdempotencyKey(ctx context.Context, userID, key string) (Order, error)
	ListOrdersForUser(ctx context.Context, userID string, limit, offset int32) ([]Order, int64, error)
	MarkOrderPaid(ctx context.Context, orderID string) error
	MarkOrderRefunded(ctx context.Context, orderID string) error
	CreateOrderItem(ctx context.Context, orderID string, item OrderItem) (OrderItem, error)
	ListOrderItems(ctx context.Context, orderID string) ([]OrderItem, error)

	GetCouponByCode(ctx context.Context, code string) (Coupon, error)
	GetUsableCouponByCode(ctx context.Context, code string) (Coupon, error)
	CountCouponRedemptions(ctx context.Context, couponID string) (int64, error)
	CountCouponRedemptionsForUser(ctx context.Context, couponID, userID string) (int64, error)
	CreateCouponRedemption(ctx context.Context, couponID, userID, orderID string, discountIRR int64) error

	GrantEntitlement(ctx context.Context, userID, bookID, audioEditionID string, origin EntitlementOrigin, sourceReferenceID string, expiresAt *time.Time) (Entitlement, error)
	IsUserEntitledToEdition(ctx context.Context, userID, audioEditionID, bookID string) (bool, error)
	IsUserEntitledToBook(ctx context.Context, userID, bookID string) (bool, error)
	ListActiveEntitlements(ctx context.Context, userID string) ([]Entitlement, error)
	RevokeEntitlementsForOrder(ctx context.Context, orderID string) error

	ListSubscriptionPlans(ctx context.Context) ([]SubscriptionPlan, error)
	GetSubscriptionPlanByCode(ctx context.Context, code string) (SubscriptionPlan, error)
	GetActiveSubscription(ctx context.Context, userID string) (Subscription, error)
	CreateSubscription(ctx context.Context, userID, planID string, expiresAt time.Time, autoRenew bool) (Subscription, error)
	ExtendSubscription(ctx context.Context, subscriptionID string, days int) error
	CancelSubscription(ctx context.Context, subscriptionID, userID string) error
	AddSubscriptionHours(ctx context.Context, subscriptionID string, hours float64) error
	ExpireDueSubscriptions(ctx context.Context) (int, error)
	ListSubscriptionsDueForRenewal(ctx context.Context, window RenewalWindow) ([]Subscription, error)
	MarkRenewalAttempt(ctx context.Context, subscriptionID string, succeeded bool) error
	ReactivateSubscription(ctx context.Context, subscriptionID string) error
	GetSubscriptionByID(ctx context.Context, subscriptionID string) (Subscription, error)

	CreateRefund(ctx context.Context, orderID, userID string, amountIRR int64, reason string) (Refund, error)
	GetRefundByID(ctx context.Context, refundID string) (Refund, error)
	ResolveRefund(ctx context.Context, refundID, status, resolvedBy string) (Refund, error)
	ListRefundsForOrder(ctx context.Context, orderID string) ([]Refund, error)
}

// EditionPricer is catalog's slice. Prices are read from catalog at
// purchase time and never trusted from the request: a client that could
// name its own price is a client that will.
type EditionPricer interface {
	GetEdition(ctx context.Context, editionID string) (catalog.Edition, error)
}

// ListeningReader is library's slice, used only by the refund rule. It
// answers "how much of this book has this user actually heard" — the
// difference between a genuine refund and free consumption.
type ListeningReader interface {
	SecondsListenedForEdition(ctx context.Context, userID, audioEditionID string) (int64, error)
}

type Service struct {
	repo      Repository
	editions  EditionPricer
	listening ListeningReader
	provider  PaymentProvider
}

func NewService(repo Repository, editions EditionPricer, listening ListeningReader, provider PaymentProvider) *Service {
	return &Service{repo: repo, editions: editions, listening: listening, provider: provider}
}

// ---------- wallet ----------

func (s *Service) Balance(ctx context.Context, userID string) (int64, error) {
	balance, err := s.repo.GetWalletBalance(ctx, userID)
	if err != nil {
		return 0, fmt.Errorf("commerce: get wallet balance: %w", err)
	}
	return balance, nil
}

func (s *Service) LedgerHistory(ctx context.Context, userID string, limit, offset int32) ([]WalletLedgerEntry, int64, error) {
	entries, total, err := s.repo.ListWalletLedger(ctx, userID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("commerce: list ledger: %w", err)
	}
	return entries, total, nil
}

// Credit appends a credit entry. It needs no lock: adding money can
// never make the balance invalid.
func (s *Service) Credit(ctx context.Context, userID string, amountIRR int64, reason, referenceType, referenceID string) (WalletLedgerEntry, error) {
	if amountIRR <= 0 {
		return WalletLedgerEntry{}, ErrAmountInvalid
	}
	entry, err := s.repo.CreateWalletLedgerEntry(ctx, userID, EntryTypeCredit, amountIRR, reason, referenceType, referenceID)
	if err != nil {
		return WalletLedgerEntry{}, fmt.Errorf("commerce: credit wallet: %w", err)
	}
	return entry, nil
}

// Debit removes money and is the operation that must never race.
//
// The balance is a SUM over an append-only ledger by deliberate design
// (08-decisions.md) — there is no balance column to put a CHECK
// constraint on. So correctness comes from the transaction: take the
// per-user advisory lock, recompute the balance inside the lock, and
// only then append. Two concurrent purchases serialise behind the lock
// and the second one sees the first one's debit.
//
// Callers already inside a transaction pass their own repo through
// InTx, so a purchase gets one lock covering debit + entitlement, not
// two independent ones.
func (s *Service) Debit(ctx context.Context, userID string, amountIRR int64, reason, referenceType, referenceID string) (WalletLedgerEntry, error) {
	if amountIRR <= 0 {
		return WalletLedgerEntry{}, ErrAmountInvalid
	}

	var entry WalletLedgerEntry
	err := s.repo.InTx(ctx, func(tx Repository) error {
		var err error
		entry, err = debitLocked(ctx, tx, userID, amountIRR, reason, referenceType, referenceID)
		return err
	})
	if err != nil {
		return WalletLedgerEntry{}, err
	}
	return entry, nil
}

func debitLocked(ctx context.Context, tx Repository, userID string, amountIRR int64, reason, referenceType, referenceID string) (WalletLedgerEntry, error) {
	if err := tx.LockWallet(ctx, userID); err != nil {
		return WalletLedgerEntry{}, fmt.Errorf("commerce: lock wallet: %w", err)
	}

	balance, err := tx.GetWalletBalance(ctx, userID)
	if err != nil {
		return WalletLedgerEntry{}, fmt.Errorf("commerce: read balance: %w", err)
	}
	if balance < amountIRR {
		return WalletLedgerEntry{}, ErrInsufficientFunds
	}

	entry, err := tx.CreateWalletLedgerEntry(ctx, userID, EntryTypeDebit, amountIRR, reason, referenceType, referenceID)
	if err != nil {
		return WalletLedgerEntry{}, fmt.Errorf("commerce: debit wallet: %w", err)
	}
	return entry, nil
}

// ---------- top-up ----------

type TopUpResult struct {
	PaymentID   string
	RedirectURL string
	Authority   string
}

func (s *Service) StartTopUp(ctx context.Context, userID string, amountIRR int64, callbackURL, mobile string) (TopUpResult, error) {
	if amountIRR < minTopUpIRR || amountIRR > maxTopUpIRR {
		return TopUpResult{}, ErrAmountInvalid
	}

	started, err := s.provider.Start(ctx, StartPaymentRequest{
		AmountIRR: amountIRR, Description: "شارژ کیف پول کتاپاد",
		CallbackURL: callbackURL, UserID: userID, Mobile: mobile,
	})
	if err != nil {
		return TopUpResult{}, fmt.Errorf("commerce: start payment: %w", err)
	}

	payment, err := s.repo.CreatePayment(ctx, userID, s.provider.Name(), amountIRR, started.Authority)
	if err != nil {
		return TopUpResult{}, fmt.Errorf("commerce: record payment: %w", err)
	}

	return TopUpResult{PaymentID: payment.ID, RedirectURL: started.RedirectURL, Authority: started.Authority}, nil
}

// SettleTopUp verifies with the gateway and credits the wallet exactly
// once.
//
// Everything here is built for the callback arriving twice, which
// Iranian gateways do: the payment row is locked, the status transition
// is conditional on it still being 'pending', and a second callback for
// an already-succeeded payment returns the same result instead of
// crediting again.
func (s *Service) SettleTopUp(ctx context.Context, provider, authority string) (Payment, error) {
	payment, err := s.repo.GetPaymentByAuthority(ctx, provider, authority)
	if err != nil {
		return Payment{}, err
	}

	if payment.Status == PaymentSucceeded {
		return payment, nil
	}

	verified, err := s.provider.Verify(ctx, authority, payment.AmountIRR)
	if err != nil || !verified.Succeeded {
		reason := "verification_failed"
		if verified.FailureReason != "" {
			reason = verified.FailureReason
		}
		if markErr := s.repo.MarkPaymentFailed(ctx, payment.ID, reason); markErr != nil {
			return Payment{}, fmt.Errorf("commerce: mark payment failed: %w", markErr)
		}
		return Payment{}, ErrPaymentVerificationFailed
	}

	var settled Payment
	err = s.repo.InTx(ctx, func(tx Repository) error {
		locked, err := tx.LockPaymentForSettlement(ctx, payment.ID)
		if err != nil {
			return err
		}
		if locked.Status == PaymentSucceeded {
			settled = locked
			return nil
		}

		entry, err := tx.CreateWalletLedgerEntry(ctx, locked.UserID, EntryTypeCredit,
			locked.AmountIRR, ReasonTopUp, "payment", locked.ID)
		if err != nil {
			return fmt.Errorf("commerce: credit wallet on settle: %w", err)
		}

		settled, err = tx.MarkPaymentSucceeded(ctx, locked.ID, verified.ReferenceCode, entry.ID)
		if err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return Payment{}, err
	}

	return settled, nil
}

// ---------- purchase ----------

type PurchaseResult struct {
	Order        Order
	Entitlements []Entitlement
	Reused       bool
}

// Purchase turns wallet credit into entitlements.
//
// The whole thing is one transaction holding one wallet lock: price the
// lines from catalog, apply the coupon, debit, write the order, grant
// the entitlements. If any step fails the money is not gone — which is
// the only acceptable outcome when the ledger cannot be edited
// afterwards.
//
// idempotencyKey exists because Iranian mobile networks drop responses
// and clients retry. Without it, a retried purchase charges twice and
// the second charge is a support ticket, not a bug report.
func (s *Service) Purchase(ctx context.Context, userID string, lines []PurchaseLine, couponCode, idempotencyKey string) (PurchaseResult, error) {
	if len(lines) == 0 {
		return PurchaseResult{}, ErrEmptyPurchase
	}

	if idempotencyKey != "" {
		if existing, err := s.repo.GetOrderByIdempotencyKey(ctx, userID, idempotencyKey); err == nil {
			full, err := s.repo.GetOrderByID(ctx, existing.ID)
			if err != nil {
				return PurchaseResult{}, err
			}
			return PurchaseResult{Order: full, Reused: true}, nil
		} else if !errors.Is(err, ErrNotFound) {
			return PurchaseResult{}, err
		}
	}

	priced := make([]OrderItem, 0, len(lines))
	var subtotal int64
	for _, line := range lines {
		edition, err := s.editions.GetEdition(ctx, line.AudioEditionID)
		if err != nil {
			return PurchaseResult{}, fmt.Errorf("commerce: price line %s: %w", line.AudioEditionID, err)
		}

		recipient := line.RecipientUserID
		if recipient == "" || recipient == userID {
			// Buying something already owned is a client bug, not a
			// purchase. Gifting to someone who owns it is allowed —
			// the buyer cannot see the recipient's library.
			owned, err := s.repo.IsUserEntitledToEdition(ctx, userID, edition.AudioEditionID, edition.BookID)
			if err != nil {
				return PurchaseResult{}, err
			}
			if owned {
				return PurchaseResult{}, ErrAlreadyOwned
			}
		}

		subtotal += edition.PriceIRR
		priced = append(priced, OrderItem{
			AudioEditionID:  edition.AudioEditionID,
			BookID:          edition.BookID,
			UnitPriceIRR:    edition.PriceIRR,
			RecipientUserID: line.RecipientUserID,
			GiftMessage:     line.GiftMessage,
		})
	}

	var coupon Coupon
	var discount int64
	if couponCode != "" {
		var err error
		coupon, discount, err = s.evaluateCoupon(ctx, userID, couponCode, subtotal)
		if err != nil {
			return PurchaseResult{}, err
		}
	}

	total := subtotal - discount

	var result PurchaseResult
	err := s.repo.InTx(ctx, func(tx Repository) error {
		order, err := tx.CreateOrder(ctx, userID, subtotal, discount, total, coupon.ID, idempotencyKey)
		if err != nil {
			return fmt.Errorf("commerce: create order: %w", err)
		}

		// A fully discounted order still goes through the order and
		// entitlement path; it just skips the ledger. Writing a
		// zero-value debit would violate the amount > 0 CHECK and
		// pollute the audit trail with no-ops.
		if total > 0 {
			if _, err := debitLocked(ctx, tx, userID, total, ReasonPurchase, "order", order.ID); err != nil {
				return err
			}
		}

		entitlements := make([]Entitlement, 0, len(priced))
		for _, item := range priced {
			created, err := tx.CreateOrderItem(ctx, order.ID, item)
			if err != nil {
				return fmt.Errorf("commerce: create order item: %w", err)
			}
			order.Items = append(order.Items, created)

			owner := userID
			origin := EntitlementOriginPurchase
			if item.RecipientUserID != "" && item.RecipientUserID != userID {
				owner = item.RecipientUserID
				origin = EntitlementOriginGift
			}

			ent, err := tx.GrantEntitlement(ctx, owner, item.BookID, item.AudioEditionID, origin, order.ID, nil)
			if err != nil {
				return fmt.Errorf("commerce: grant entitlement: %w", err)
			}
			entitlements = append(entitlements, ent)
		}

		if coupon.ID != "" && discount > 0 {
			if err := tx.CreateCouponRedemption(ctx, coupon.ID, userID, order.ID, discount); err != nil {
				return fmt.Errorf("commerce: redeem coupon: %w", err)
			}
		}

		if err := tx.MarkOrderPaid(ctx, order.ID); err != nil {
			return fmt.Errorf("commerce: mark order paid: %w", err)
		}

		order.Status = OrderPaid
		result = PurchaseResult{Order: order, Entitlements: entitlements}
		return nil
	})
	if err != nil {
		return PurchaseResult{}, err
	}

	return result, nil
}

// evaluateCoupon applies every eligibility rule before the arithmetic in
// Coupon.Discount. Redemption counts are checked here and written inside
// the purchase transaction; a coupon can therefore be over-redeemed only
// by the number of purchases racing in the same instant, which for a
// discount code is an acceptable trade against serialising all coupon
// use behind one lock.
func (s *Service) evaluateCoupon(ctx context.Context, userID, code string, subtotal int64) (Coupon, int64, error) {
	// The validity window is filtered in SQL so the database clock — not
	// this process's — decides whether the campaign is live.
	coupon, err := s.repo.GetUsableCouponByCode(ctx, strings.ToUpper(strings.TrimSpace(code)))
	if err != nil {
		return Coupon{}, 0, err
	}

	if subtotal < coupon.MinSubtotalIRR {
		return Coupon{}, 0, ErrCouponNotUsable
	}

	if coupon.MaxRedemptions > 0 {
		used, err := s.repo.CountCouponRedemptions(ctx, coupon.ID)
		if err != nil {
			return Coupon{}, 0, err
		}
		if used >= int64(coupon.MaxRedemptions) {
			return Coupon{}, 0, ErrCouponNotUsable
		}
	}

	if coupon.PerUserLimit > 0 {
		used, err := s.repo.CountCouponRedemptionsForUser(ctx, coupon.ID, userID)
		if err != nil {
			return Coupon{}, 0, err
		}
		if used >= int64(coupon.PerUserLimit) {
			return Coupon{}, 0, ErrCouponNotUsable
		}
	}

	discount := coupon.Discount(subtotal)
	if discount <= 0 {
		return Coupon{}, 0, ErrCouponNotUsable
	}
	return coupon, discount, nil
}

// PreviewCoupon lets the checkout screen show the discount before the
// user commits, using exactly the same rules the purchase will apply.
func (s *Service) PreviewCoupon(ctx context.Context, userID, code string, subtotal int64) (int64, error) {
	_, discount, err := s.evaluateCoupon(ctx, userID, code, subtotal)
	return discount, err
}

func (s *Service) ListOrders(ctx context.Context, userID string, limit, offset int32) ([]Order, int64, error) {
	return s.repo.ListOrdersForUser(ctx, userID, limit, offset)
}

func (s *Service) GetOrder(ctx context.Context, userID, orderID string) (Order, error) {
	order, err := s.repo.GetOrderByID(ctx, orderID)
	if err != nil {
		return Order{}, err
	}
	if order.UserID != userID {
		return Order{}, ErrNotFound
	}
	return order, nil
}
