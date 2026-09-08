package commerce

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"ketapod/internal/commerce/sqlcgen"
)

// pgRepo is the only file in this module that knows SQL or pgx types.
//
// It carries the pool as well as the queries because commerce is the one
// module with genuine multi-statement invariants: a purchase that debits
// the wallet but fails to grant the entitlement takes money for nothing,
// and an append-only ledger cannot be "fixed" by an UPDATE afterwards —
// only by a compensating entry and an apology.
type pgRepo struct {
	pool *pgxpool.Pool
	q    *sqlcgen.Queries
}

func NewRepository(pool *pgxpool.Pool) Repository {
	return &pgRepo{pool: pool, q: sqlcgen.New(pool)}
}

// InTx runs fn inside a database transaction. A repo already inside a
// transaction runs fn directly rather than opening a nested one: pgx has
// no real nested transactions, and savepoint semantics here would hide
// partial failures instead of surfacing them.
func (r *pgRepo) InTx(ctx context.Context, fn func(Repository) error) error {
	if r.pool == nil {
		return fn(r)
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("commerce: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(&pgRepo{pool: nil, q: r.q.WithTx(tx)}); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commerce: commit tx: %w", err)
	}
	return nil
}

func (r *pgRepo) LockWallet(ctx context.Context, userID string) error {
	return r.q.LockWallet(ctx, userID)
}

func (r *pgRepo) CreateWalletLedgerEntry(ctx context.Context, userID string, entryType EntryType, amountIRR int64, reason, referenceType, referenceID string) (WalletLedgerEntry, error) {
	parsedUserID, err := uuid.Parse(userID)
	if err != nil {
		return WalletLedgerEntry{}, fmt.Errorf("commerce: parse user id: %w", err)
	}

	refID, err := toPgUUID(referenceID)
	if err != nil {
		return WalletLedgerEntry{}, fmt.Errorf("commerce: parse reference id: %w", err)
	}

	row, err := r.q.CreateWalletLedgerEntry(ctx, sqlcgen.CreateWalletLedgerEntryParams{
		UserID:        parsedUserID,
		EntryType:     string(entryType),
		AmountIrr:     amountIRR,
		Reason:        reason,
		ReferenceType: nullableString(referenceType),
		ReferenceID:   refID,
	})
	if err != nil {
		return WalletLedgerEntry{}, err
	}

	return WalletLedgerEntry{
		ID:            row.ID.String(),
		UserID:        row.UserID.String(),
		EntryType:     EntryType(row.EntryType),
		AmountIRR:     row.AmountIrr,
		Reason:        row.Reason,
		ReferenceType: stringOrEmpty(row.ReferenceType),
		ReferenceID:   fromPgUUID(row.ReferenceID),
		CreatedAt:     row.CreatedAt,
	}, nil
}

func (r *pgRepo) GetWalletBalance(ctx context.Context, userID string) (int64, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return 0, fmt.Errorf("commerce: parse user id: %w", err)
	}
	return r.q.GetWalletBalance(ctx, parsedID)
}

func (r *pgRepo) ListWalletLedger(ctx context.Context, userID string, limit, offset int32) ([]WalletLedgerEntry, int64, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return nil, 0, fmt.Errorf("commerce: parse user id: %w", err)
	}
	rows, err := r.q.ListWalletLedgerForUser(ctx, sqlcgen.ListWalletLedgerForUserParams{
		UserID: parsedID, Limit: limit, Offset: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	entries := make([]WalletLedgerEntry, len(rows))
	var total int64
	for i, row := range rows {
		total = row.TotalCount
		entries[i] = WalletLedgerEntry{
			ID: row.ID.String(), UserID: row.UserID.String(),
			EntryType: EntryType(row.EntryType), AmountIRR: row.AmountIrr,
			Reason: row.Reason, ReferenceType: stringOrEmpty(row.ReferenceType),
			ReferenceID: fromPgUUID(row.ReferenceID), CreatedAt: row.CreatedAt,
		}
	}
	return entries, total, nil
}

func (r *pgRepo) CreatePayment(ctx context.Context, userID, provider string, amountIRR int64, authority string) (Payment, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return Payment{}, fmt.Errorf("commerce: parse user id: %w", err)
	}
	row, err := r.q.CreatePayment(ctx, sqlcgen.CreatePaymentParams{
		UserID: parsedID, Provider: provider, AmountIrr: amountIRR, Authority: nullableString(authority),
	})
	if err != nil {
		return Payment{}, err
	}
	return toPayment(row), nil
}

func (r *pgRepo) GetPaymentByAuthority(ctx context.Context, provider, authority string) (Payment, error) {
	row, err := r.q.GetPaymentByAuthority(ctx, sqlcgen.GetPaymentByAuthorityParams{
		Provider: provider, Authority: nullableString(authority),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Payment{}, ErrNotFound
		}
		return Payment{}, err
	}
	return toPayment(row), nil
}

// LockPaymentForSettlement takes a row lock so two concurrent gateway
// callbacks for the same authority — which really do arrive, because
// gateways retry — cannot both credit the wallet.
func (r *pgRepo) LockPaymentForSettlement(ctx context.Context, paymentID string) (Payment, error) {
	parsedID, err := uuid.Parse(paymentID)
	if err != nil {
		return Payment{}, fmt.Errorf("commerce: parse payment id: %w", err)
	}
	row, err := r.q.LockPaymentForSettlement(ctx, parsedID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Payment{}, ErrNotFound
		}
		return Payment{}, err
	}
	return toPayment(row), nil
}

func (r *pgRepo) MarkPaymentSucceeded(ctx context.Context, paymentID, referenceCode, ledgerEntryID string) (Payment, error) {
	parsedID, err := uuid.Parse(paymentID)
	if err != nil {
		return Payment{}, fmt.Errorf("commerce: parse payment id: %w", err)
	}
	ledgerID, err := toPgUUID(ledgerEntryID)
	if err != nil {
		return Payment{}, fmt.Errorf("commerce: parse ledger entry id: %w", err)
	}
	row, err := r.q.MarkPaymentSucceeded(ctx, sqlcgen.MarkPaymentSucceededParams{
		ID: parsedID, ReferenceCode: nullableString(referenceCode), LedgerEntryID: ledgerID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Payment{}, ErrPaymentAlreadySettled
		}
		return Payment{}, err
	}
	return toPayment(row), nil
}

func (r *pgRepo) MarkPaymentFailed(ctx context.Context, paymentID, reason string) error {
	parsedID, err := uuid.Parse(paymentID)
	if err != nil {
		return fmt.Errorf("commerce: parse payment id: %w", err)
	}
	if _, err := r.q.MarkPaymentFailed(ctx, sqlcgen.MarkPaymentFailedParams{
		ID: parsedID, FailureReason: nullableString(reason),
	}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return nil
}

func (r *pgRepo) CreateOrder(ctx context.Context, userID string, subtotal, discount, total int64, couponID, idempotencyKey string) (Order, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return Order{}, fmt.Errorf("commerce: parse user id: %w", err)
	}
	coupon, err := toPgUUID(couponID)
	if err != nil {
		return Order{}, fmt.Errorf("commerce: parse coupon id: %w", err)
	}
	row, err := r.q.CreateOrder(ctx, sqlcgen.CreateOrderParams{
		UserID: parsedID, SubtotalIrr: subtotal, DiscountIrr: discount, TotalIrr: total,
		CouponID: coupon, IdempotencyKey: nullableString(idempotencyKey),
	})
	if err != nil {
		return Order{}, err
	}
	return toOrder(row), nil
}

func (r *pgRepo) GetOrderByIdempotencyKey(ctx context.Context, userID, key string) (Order, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return Order{}, fmt.Errorf("commerce: parse user id: %w", err)
	}
	row, err := r.q.GetOrderByIdempotencyKey(ctx, sqlcgen.GetOrderByIdempotencyKeyParams{
		UserID: parsedID, IdempotencyKey: nullableString(key),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Order{}, ErrNotFound
		}
		return Order{}, err
	}
	return toOrder(row), nil
}

func (r *pgRepo) GetOrderByID(ctx context.Context, orderID string) (Order, error) {
	parsedID, err := uuid.Parse(orderID)
	if err != nil {
		return Order{}, ErrNotFound
	}
	row, err := r.q.GetOrderByID(ctx, parsedID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Order{}, ErrNotFound
		}
		return Order{}, err
	}
	order := toOrder(row)
	items, err := r.ListOrderItems(ctx, order.ID)
	if err != nil {
		return Order{}, err
	}
	order.Items = items
	return order, nil
}

func (r *pgRepo) ListOrdersForUser(ctx context.Context, userID string, limit, offset int32) ([]Order, int64, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return nil, 0, fmt.Errorf("commerce: parse user id: %w", err)
	}
	rows, err := r.q.ListOrdersForUser(ctx, sqlcgen.ListOrdersForUserParams{
		UserID: parsedID, Limit: limit, Offset: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	orders := make([]Order, len(rows))
	var total int64
	for i, row := range rows {
		total = row.TotalCount
		orders[i] = Order{
			ID: row.ID.String(), UserID: row.UserID.String(), Status: OrderStatus(row.Status),
			SubtotalIRR: row.SubtotalIrr, DiscountIRR: row.DiscountIrr, TotalIRR: row.TotalIrr,
			CouponID: fromPgUUID(row.CouponID), CreatedAt: row.CreatedAt,
			PaidAt: fromPgTimestamptz(row.PaidAt),
		}
	}
	return orders, total, nil
}

func (r *pgRepo) MarkOrderPaid(ctx context.Context, orderID string) error {
	parsedID, err := uuid.Parse(orderID)
	if err != nil {
		return fmt.Errorf("commerce: parse order id: %w", err)
	}
	if _, err := r.q.MarkOrderPaid(ctx, parsedID); err != nil {
		return err
	}
	return nil
}

func (r *pgRepo) MarkOrderRefunded(ctx context.Context, orderID string) error {
	parsedID, err := uuid.Parse(orderID)
	if err != nil {
		return fmt.Errorf("commerce: parse order id: %w", err)
	}
	return r.q.MarkOrderRefunded(ctx, parsedID)
}

func (r *pgRepo) CreateOrderItem(ctx context.Context, orderID string, item OrderItem) (OrderItem, error) {
	orderUUID, err := uuid.Parse(orderID)
	if err != nil {
		return OrderItem{}, fmt.Errorf("commerce: parse order id: %w", err)
	}
	editionUUID, err := uuid.Parse(item.AudioEditionID)
	if err != nil {
		return OrderItem{}, fmt.Errorf("commerce: parse audio edition id: %w", err)
	}
	bookUUID, err := uuid.Parse(item.BookID)
	if err != nil {
		return OrderItem{}, fmt.Errorf("commerce: parse book id: %w", err)
	}
	recipient, err := toPgUUID(item.RecipientUserID)
	if err != nil {
		return OrderItem{}, fmt.Errorf("commerce: parse recipient id: %w", err)
	}

	row, err := r.q.CreateOrderItem(ctx, sqlcgen.CreateOrderItemParams{
		OrderID: orderUUID, AudioEditionID: editionUUID, BookID: bookUUID,
		UnitPriceIrr: item.UnitPriceIRR, RecipientUserID: recipient,
		GiftMessage: nullableString(item.GiftMessage),
	})
	if err != nil {
		return OrderItem{}, err
	}
	return OrderItem{
		ID: row.ID.String(), OrderID: row.OrderID.String(),
		AudioEditionID: row.AudioEditionID.String(), BookID: row.BookID.String(),
		UnitPriceIRR: row.UnitPriceIrr, RecipientUserID: fromPgUUID(row.RecipientUserID),
		GiftMessage: stringOrEmpty(row.GiftMessage),
	}, nil
}

func (r *pgRepo) ListOrderItems(ctx context.Context, orderID string) ([]OrderItem, error) {
	parsedID, err := uuid.Parse(orderID)
	if err != nil {
		return nil, fmt.Errorf("commerce: parse order id: %w", err)
	}
	rows, err := r.q.ListOrderItems(ctx, parsedID)
	if err != nil {
		return nil, err
	}
	items := make([]OrderItem, len(rows))
	for i, row := range rows {
		items[i] = OrderItem{
			ID: row.ID.String(), OrderID: row.OrderID.String(),
			AudioEditionID: row.AudioEditionID.String(), BookID: row.BookID.String(),
			UnitPriceIRR: row.UnitPriceIrr, RecipientUserID: fromPgUUID(row.RecipientUserID),
			GiftMessage: stringOrEmpty(row.GiftMessage),
		}
	}
	return items, nil
}

// GetUsableCouponByCode returns only coupons whose validity window is
// open right now, judged by the database clock. A code that exists but
// has not started or has expired comes back as ErrCouponNotFound: from
// the buyer's point of view those are the same thing, and telling them
// apart would leak the existence of unannounced campaigns.
func (r *pgRepo) GetUsableCouponByCode(ctx context.Context, code string) (Coupon, error) {
	row, err := r.q.GetUsableCouponByCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Coupon{}, ErrCouponNotFound
		}
		return Coupon{}, err
	}
	return toCoupon(sqlcgen.CommerceCoupon(row)), nil
}

func (r *pgRepo) GetCouponByCode(ctx context.Context, code string) (Coupon, error) {
	row, err := r.q.GetCouponByCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Coupon{}, ErrCouponNotFound
		}
		return Coupon{}, err
	}
	return toCoupon(row), nil
}

func toCoupon(row sqlcgen.CommerceCoupon) Coupon {
	coupon := Coupon{
		ID: row.ID.String(), Code: row.Code, Kind: CouponKind(row.Kind), Value: row.Value,
		MinSubtotalIRR: row.MinSubtotalIrr, PerUserLimit: int(row.PerUserLimit),
		StartsAt: row.StartsAt, ExpiresAt: fromPgTimestamptz(row.ExpiresAt), IsActive: row.IsActive,
	}
	if row.MaxDiscountIrr != nil {
		coupon.MaxDiscountIRR = *row.MaxDiscountIrr
	}
	if row.MaxRedemptions != nil {
		coupon.MaxRedemptions = int(*row.MaxRedemptions)
	}
	return coupon
}

func (r *pgRepo) CountCouponRedemptions(ctx context.Context, couponID string) (int64, error) {
	parsedID, err := uuid.Parse(couponID)
	if err != nil {
		return 0, fmt.Errorf("commerce: parse coupon id: %w", err)
	}
	return r.q.CountCouponRedemptions(ctx, parsedID)
}

func (r *pgRepo) CountCouponRedemptionsForUser(ctx context.Context, couponID, userID string) (int64, error) {
	couponUUID, err := uuid.Parse(couponID)
	if err != nil {
		return 0, fmt.Errorf("commerce: parse coupon id: %w", err)
	}
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return 0, fmt.Errorf("commerce: parse user id: %w", err)
	}
	return r.q.CountCouponRedemptionsForUser(ctx, sqlcgen.CountCouponRedemptionsForUserParams{
		CouponID: couponUUID, UserID: userUUID,
	})
}

func (r *pgRepo) CreateCouponRedemption(ctx context.Context, couponID, userID, orderID string, discountIRR int64) error {
	couponUUID, err := uuid.Parse(couponID)
	if err != nil {
		return fmt.Errorf("commerce: parse coupon id: %w", err)
	}
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return fmt.Errorf("commerce: parse user id: %w", err)
	}
	orderUUID, err := uuid.Parse(orderID)
	if err != nil {
		return fmt.Errorf("commerce: parse order id: %w", err)
	}
	return r.q.CreateCouponRedemption(ctx, sqlcgen.CreateCouponRedemptionParams{
		CouponID: couponUUID, UserID: userUUID, OrderID: orderUUID, DiscountIrr: discountIRR,
	})
}

func (r *pgRepo) GrantEntitlement(ctx context.Context, userID, bookID, audioEditionID string, origin EntitlementOrigin, sourceReferenceID string, expiresAt *time.Time) (Entitlement, error) {
	parsedUserID, err := uuid.Parse(userID)
	if err != nil {
		return Entitlement{}, fmt.Errorf("commerce: parse user id: %w", err)
	}
	bookUUID, err := toPgUUID(bookID)
	if err != nil {
		return Entitlement{}, fmt.Errorf("commerce: parse book id: %w", err)
	}
	editionUUID, err := toPgUUID(audioEditionID)
	if err != nil {
		return Entitlement{}, fmt.Errorf("commerce: parse audio edition id: %w", err)
	}
	sourceRefUUID, err := toPgUUID(sourceReferenceID)
	if err != nil {
		return Entitlement{}, fmt.Errorf("commerce: parse source reference id: %w", err)
	}

	row, err := r.q.GrantEntitlementIdempotent(ctx, sqlcgen.GrantEntitlementIdempotentParams{
		UserID: parsedUserID, BookID: bookUUID, AudioEditionID: editionUUID,
		Origin: string(origin), SourceReferenceID: sourceRefUUID,
		ExpiresAt: toPgTimestamptz(expiresAt),
	})
	if err != nil {
		return Entitlement{}, err
	}

	return Entitlement{
		ID: row.ID.String(), UserID: row.UserID.String(),
		BookID: fromPgUUID(row.BookID), AudioEditionID: fromPgUUID(row.AudioEditionID),
		Origin: EntitlementOrigin(row.Origin), GrantedAt: row.GrantedAt,
		ExpiresAt: fromPgTimestamptz(row.ExpiresAt), RevokedAt: fromPgTimestamptz(row.RevokedAt),
	}, nil
}

func (r *pgRepo) IsUserEntitledToEdition(ctx context.Context, userID, audioEditionID, bookID string) (bool, error) {
	parsedUserID, err := uuid.Parse(userID)
	if err != nil {
		return false, fmt.Errorf("commerce: parse user id: %w", err)
	}
	editionUUID, err := toPgUUID(audioEditionID)
	if err != nil {
		return false, fmt.Errorf("commerce: parse audio edition id: %w", err)
	}
	bookUUID, err := toPgUUID(bookID)
	if err != nil {
		return false, fmt.Errorf("commerce: parse book id: %w", err)
	}
	return r.q.IsUserEntitledToEdition(ctx, sqlcgen.IsUserEntitledToEditionParams{
		UserID: parsedUserID, AudioEditionID: editionUUID, BookID: bookUUID,
	})
}

func (r *pgRepo) IsUserEntitledToBook(ctx context.Context, userID, bookID string) (bool, error) {
	parsedUserID, err := uuid.Parse(userID)
	if err != nil {
		return false, fmt.Errorf("commerce: parse user id: %w", err)
	}
	bookUUID, err := toPgUUID(bookID)
	if err != nil {
		return false, fmt.Errorf("commerce: parse book id: %w", err)
	}
	return r.q.IsUserEntitledToBook(ctx, sqlcgen.IsUserEntitledToBookParams{
		UserID: parsedUserID, BookID: bookUUID,
	})
}

func (r *pgRepo) ListActiveEntitlements(ctx context.Context, userID string) ([]Entitlement, error) {
	parsedID, err := uuid.Parse(userID)
	if err != nil {
		return nil, fmt.Errorf("commerce: parse user id: %w", err)
	}
	rows, err := r.q.ListActiveEntitlementsForUser(ctx, parsedID)
	if err != nil {
		return nil, err
	}
	entitlements := make([]Entitlement, len(rows))
	for i, row := range rows {
		entitlements[i] = Entitlement{
			ID: row.ID.String(), UserID: row.UserID.String(),
			BookID: fromPgUUID(row.BookID), AudioEditionID: fromPgUUID(row.AudioEditionID),
			Origin: EntitlementOrigin(row.Origin), GrantedAt: row.GrantedAt,
			ExpiresAt: fromPgTimestamptz(row.ExpiresAt),
		}
	}
	return entitlements, nil
}

func (r *pgRepo) RevokeEntitlementsForOrder(ctx context.Context, orderID string) error {
	parsedID, err := toPgUUID(orderID)
	if err != nil {
		return fmt.Errorf("commerce: parse order id: %w", err)
	}
	return r.q.RevokeEntitlementsForOrder(ctx, parsedID)
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

func toPgUUID(id string) (pgtype.UUID, error) {
	if id == "" {
		return pgtype.UUID{}, nil
	}
	parsed, err := uuid.Parse(id)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: parsed, Valid: true}, nil
}

func fromPgUUID(id pgtype.UUID) string {
	if !id.Valid {
		return ""
	}
	return uuid.UUID(id.Bytes).String()
}

func toPgTimestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

func fromPgTimestamptz(ts pgtype.Timestamptz) *time.Time {
	if !ts.Valid {
		return nil
	}
	t := ts.Time
	return &t
}

func toPayment(row sqlcgen.CommercePayment) Payment {
	return Payment{
		ID: row.ID.String(), UserID: row.UserID.String(), Provider: row.Provider,
		AmountIRR: row.AmountIrr, Status: PaymentStatus(row.Status),
		Authority: stringOrEmpty(row.Authority), ReferenceCode: stringOrEmpty(row.ReferenceCode),
		CreatedAt: row.CreatedAt, SettledAt: fromPgTimestamptz(row.SettledAt),
	}
}

func toOrder(row sqlcgen.CommerceOrder) Order {
	return Order{
		ID: row.ID.String(), UserID: row.UserID.String(), Status: OrderStatus(row.Status),
		SubtotalIRR: row.SubtotalIrr, DiscountIRR: row.DiscountIrr, TotalIRR: row.TotalIrr,
		CouponID: fromPgUUID(row.CouponID), CreatedAt: row.CreatedAt,
		PaidAt: fromPgTimestamptz(row.PaidAt),
	}
}
