package commerce

import "time"

type EntryType string

const (
	EntryTypeCredit EntryType = "credit"
	EntryTypeDebit  EntryType = "debit"
)

// Reason strings on ledger entries are read by humans doing refunds and
// revenue splits months later, so they are a closed set rather than free
// text.
const (
	ReasonTopUp            = "wallet_topup"
	ReasonPurchase         = "book_purchase"
	ReasonSubscription     = "subscription_purchase"
	ReasonRefund           = "order_refund"
	ReasonGiftCard         = "gift_card_redeem"
	ReasonPromotionalGrant = "promotional_grant"
)

type WalletLedgerEntry struct {
	ID            string
	UserID        string
	EntryType     EntryType
	AmountIRR     int64
	Reason        string
	ReferenceType string
	ReferenceID   string
	CreatedAt     time.Time
}

type EntitlementOrigin string

const (
	EntitlementOriginPurchase     EntitlementOrigin = "purchase"
	EntitlementOriginGift         EntitlementOrigin = "gift"
	EntitlementOriginSubscription EntitlementOrigin = "subscription"
	EntitlementOriginOrg          EntitlementOrigin = "org"
)

type Entitlement struct {
	ID                string
	UserID            string
	BookID            string
	AudioEditionID    string
	Origin            EntitlementOrigin
	SourceReferenceID string
	GrantedAt         time.Time
	ExpiresAt         *time.Time
	RevokedAt         *time.Time
}

type OrderStatus string

const (
	OrderPending  OrderStatus = "pending"
	OrderPaid     OrderStatus = "paid"
	OrderFailed   OrderStatus = "failed"
	OrderRefunded OrderStatus = "refunded"
	OrderCanceled OrderStatus = "canceled"
)

type Order struct {
	ID          string
	UserID      string
	Status      OrderStatus
	SubtotalIRR int64
	DiscountIRR int64
	TotalIRR    int64
	CouponID    string
	CreatedAt   time.Time
	PaidAt      *time.Time
	Items       []OrderItem
}

type OrderItem struct {
	ID              string
	OrderID         string
	AudioEditionID  string
	BookID          string
	UnitPriceIRR    int64
	RecipientUserID string
	GiftMessage     string
}

// PurchaseLine is one thing being bought. RecipientUserID different from
// the buyer turns the same flow into a gift: identical money movement,
// entitlement lands elsewhere. That is exactly why 08-decisions.md keeps
// Entitlement separate from the purchase transaction.
type PurchaseLine struct {
	AudioEditionID  string
	RecipientUserID string
	GiftMessage     string
}

type PaymentStatus string

const (
	PaymentPending   PaymentStatus = "pending"
	PaymentSucceeded PaymentStatus = "succeeded"
	PaymentFailed    PaymentStatus = "failed"
)

type Payment struct {
	ID            string
	UserID        string
	Provider      string
	AmountIRR     int64
	Status        PaymentStatus
	Authority     string
	ReferenceCode string
	CreatedAt     time.Time
	SettledAt     *time.Time
}

type CouponKind string

const (
	CouponPercent CouponKind = "percent"
	CouponFixed   CouponKind = "fixed"
)

type Coupon struct {
	ID             string
	Code           string
	Kind           CouponKind
	Value          int64
	MaxDiscountIRR int64
	MinSubtotalIRR int64
	MaxRedemptions int
	PerUserLimit   int
	StartsAt       time.Time
	ExpiresAt      *time.Time
	IsActive       bool
}

// Discount is pure arithmetic on a Coupon and a subtotal, with no I/O,
// so the rounding and cap rules are unit-testable without a database.
// Percent coupons round down: a discount that rounds up hands out rial
// the company never agreed to.
func (c Coupon) Discount(subtotalIRR int64) int64 {
	if subtotalIRR < c.MinSubtotalIRR {
		return 0
	}

	var discount int64
	switch c.Kind {
	case CouponPercent:
		discount = subtotalIRR * c.Value / 100
	case CouponFixed:
		discount = c.Value
	default:
		return 0
	}

	if c.MaxDiscountIRR > 0 && discount > c.MaxDiscountIRR {
		discount = c.MaxDiscountIRR
	}
	// A coupon may make an order free but never negative — a negative
	// total would credit the wallet, turning a discount code into a
	// money printer.
	return min(discount, subtotalIRR)
}

type SubscriptionPlan struct {
	ID             string
	Code           string
	Name           string
	PriceIRR       int64
	PeriodDays     int
	MonthlyHourCap int
}

type Subscription struct {
	ID                  string
	UserID              string
	PlanID              string
	Status              string
	AutoRenewFromWallet bool
	StartedAt           time.Time
	ExpiresAt           time.Time
	HoursConsumed       float64
	Plan                *SubscriptionPlan
}

// HasCapacity is why the hour cap exists at all: "unlimited" only
// attracts the heaviest listeners and eats the margin (02-business.md).
// A subscription past its cap is still active — it just stops granting
// access to new playback until the period rolls over.
func (s Subscription) HasCapacity() bool {
	if s.Plan == nil {
		return false
	}
	return s.HoursConsumed < float64(s.Plan.MonthlyHourCap)
}

type Refund struct {
	ID          string
	OrderID     string
	UserID      string
	AmountIRR   int64
	Reason      string
	Status      string
	RequestedAt time.Time
	ResolvedAt  *time.Time
}
