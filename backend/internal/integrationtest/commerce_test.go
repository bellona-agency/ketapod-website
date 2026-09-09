package integrationtest

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"ketapod/internal/catalog"
	"ketapod/internal/commerce"
)

func newCommerceService(t *testing.T, listening commerce.ListeningReader) (*commerce.Service, *fixtures) {
	t.Helper()
	pool := newPool(t)
	f := newFixtures(t, pool)

	catalogSvc := catalog.NewService(catalog.NewRepository(pool))
	svc := commerce.NewService(
		commerce.NewRepository(pool),
		catalogSvc,
		listening,
		commerce.NewStubProvider("http://localhost/callback"),
	)
	return svc, f
}

// The wallet balance is a SUM over an append-only ledger by deliberate
// design (08-decisions.md), so there is no balance column to hang a
// CHECK constraint on. Correctness comes entirely from the advisory lock
// inside Debit — and this is the test that proves it, because it is the
// only kind of test that can: a single-threaded test passes whether or
// not the lock is there.
func TestWalletDebitIsAtomicUnderConcurrency(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000001")
	f.creditWallet(userID, 100_000)

	// Ten concurrent debits of 30,000 against a balance of 100,000.
	// Exactly three can succeed. Without the lock every goroutine reads
	// the same balance, all ten pass the check, and the wallet ends up
	// deeply negative — with no way to correct it except a compensating
	// entry and an apology to the user.
	const (
		workers     = 10
		debitAmount = 30_000
	)

	var (
		wg        sync.WaitGroup
		mu        sync.Mutex
		succeeded int
		failed    int
	)

	for i := range workers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := svc.Debit(ctx, userID, debitAmount, commerce.ReasonPurchase, "test", "")

			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				succeeded++
			} else {
				require.ErrorIs(t, err, commerce.ErrInsufficientFunds)
				failed++
			}
		}(i)
	}
	wg.Wait()

	require.Equal(t, 3, succeeded, "only three 30,000 debits fit in a 100,000 balance")
	require.Equal(t, workers-3, failed)

	balance, err := svc.Balance(ctx, userID)
	require.NoError(t, err)
	require.Equal(t, int64(10_000), balance)
	require.GreaterOrEqual(t, balance, int64(0), "the wallet must never go negative")
}

func TestWalletDebitRejectsOverdraftAndBadAmounts(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000002")
	f.creditWallet(userID, 50_000)

	t.Run("a debit larger than the balance is refused", func(t *testing.T) {
		_, err := svc.Debit(ctx, userID, 50_001, commerce.ReasonPurchase, "test", "")
		require.ErrorIs(t, err, commerce.ErrInsufficientFunds)
		require.Equal(t, int64(50_000), f.walletBalance(userID), "a refused debit writes nothing")
	})

	t.Run("a debit of exactly the balance is allowed", func(t *testing.T) {
		_, err := svc.Debit(ctx, userID, 50_000, commerce.ReasonPurchase, "test", "")
		require.NoError(t, err)
		require.Equal(t, int64(0), f.walletBalance(userID))
	})

	t.Run("zero and negative amounts are refused", func(t *testing.T) {
		_, err := svc.Debit(ctx, userID, 0, commerce.ReasonPurchase, "test", "")
		require.ErrorIs(t, err, commerce.ErrAmountInvalid)
		_, err = svc.Credit(ctx, userID, -1, commerce.ReasonTopUp, "test", "")
		require.ErrorIs(t, err, commerce.ErrAmountInvalid)
	})
}

func TestPurchaseGrantsEntitlementAndChargesOnce(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000003")
	bookID := f.book(bookOpts{Slug: "paid-book", Title: "کتاب پولی"})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", PriceIRR: 450_000, WithAsset: true})
	f.creditWallet(userID, 1_000_000)

	result, err := svc.Purchase(ctx, userID,
		[]commerce.PurchaseLine{{AudioEditionID: editionID}}, "", "order-key-1")
	require.NoError(t, err)

	require.Equal(t, commerce.OrderPaid, result.Order.Status)
	require.Equal(t, int64(450_000), result.Order.TotalIRR)
	require.Len(t, result.Entitlements, 1)
	require.Equal(t, commerce.EntitlementOriginPurchase, result.Entitlements[0].Origin)
	require.Equal(t, int64(550_000), f.walletBalance(userID))

	t.Run("the buyer can now play it", func(t *testing.T) {
		entitled, err := svc.IsEntitledToEdition(ctx, userID, editionID, bookID)
		require.NoError(t, err)
		require.True(t, entitled)
	})

	t.Run("retrying with the same idempotency key does not charge twice", func(t *testing.T) {
		// Iranian mobile networks drop responses and clients retry.
		// Without this, a retried purchase is a double charge and a
		// support ticket rather than a bug report.
		retried, err := svc.Purchase(ctx, userID,
			[]commerce.PurchaseLine{{AudioEditionID: editionID}}, "", "order-key-1")
		require.NoError(t, err)
		require.True(t, retried.Reused)
		require.Equal(t, result.Order.ID, retried.Order.ID)
		require.Equal(t, int64(550_000), f.walletBalance(userID), "no second debit")
	})

	t.Run("buying it again without a key is refused as already owned", func(t *testing.T) {
		_, err := svc.Purchase(ctx, userID,
			[]commerce.PurchaseLine{{AudioEditionID: editionID}}, "", "")
		require.ErrorIs(t, err, commerce.ErrAlreadyOwned)
	})
}

// A failed purchase must leave the wallet exactly as it was. The order,
// the debit and the entitlement are one transaction precisely because
// the ledger cannot be edited afterwards.
func TestPurchaseWithInsufficientFundsLeavesNothingBehind(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000004")
	bookID := f.book(bookOpts{Slug: "expensive", Title: "گران"})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", PriceIRR: 900_000, WithAsset: true})
	f.creditWallet(userID, 100_000)

	_, err := svc.Purchase(ctx, userID,
		[]commerce.PurchaseLine{{AudioEditionID: editionID}}, "", "")
	require.ErrorIs(t, err, commerce.ErrInsufficientFunds)

	require.Equal(t, int64(100_000), f.walletBalance(userID), "balance untouched")
	require.Equal(t, 0, f.countRows("commerce.orders", "user_id = $1", userID), "no order row survives")
	require.Equal(t, 0, f.countRows("commerce.entitlements", "user_id = $1", userID), "no entitlement granted")

	entitled, err := svc.IsEntitledToEdition(ctx, userID, editionID, bookID)
	require.NoError(t, err)
	require.False(t, entitled)
}

func TestPurchaseAppliesCoupon(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000005")
	bookID := f.book(bookOpts{Slug: "coupon-book", Title: "با تخفیف"})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", PriceIRR: 500_000, WithAsset: true})
	f.creditWallet(userID, 1_000_000)
	f.coupon("WELCOME20", "percent", 20, 200_000, 100_000, 1)

	result, err := svc.Purchase(ctx, userID,
		[]commerce.PurchaseLine{{AudioEditionID: editionID}}, "welcome20", "")
	require.NoError(t, err)

	require.Equal(t, int64(500_000), result.Order.SubtotalIRR)
	require.Equal(t, int64(100_000), result.Order.DiscountIRR)
	require.Equal(t, int64(400_000), result.Order.TotalIRR)
	require.Equal(t, int64(600_000), f.walletBalance(userID))

	t.Run("the per-user limit stops a second use", func(t *testing.T) {
		other := f.book(bookOpts{Slug: "coupon-book-2", Title: "دوم"})
		otherEdition := f.edition(editionOpts{BookID: other, VoiceID: "v1", PriceIRR: 500_000, WithAsset: true})

		_, err := svc.Purchase(ctx, userID,
			[]commerce.PurchaseLine{{AudioEditionID: otherEdition}}, "WELCOME20", "")
		require.ErrorIs(t, err, commerce.ErrCouponNotUsable)
	})

	t.Run("an unknown code is refused rather than silently ignored", func(t *testing.T) {
		_, err := svc.PreviewCoupon(ctx, userID, "NOPE", 500_000)
		require.ErrorIs(t, err, commerce.ErrCouponNotFound)
	})
}

// A fully discounted order still produces an order and an entitlement,
// but writes no ledger entry: a zero-amount debit would violate the
// amount > 0 CHECK and pollute the audit trail with no-ops.
func TestFullyDiscountedPurchaseSkipsTheLedger(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000006")
	bookID := f.book(bookOpts{Slug: "free-with-coupon", Title: "رایگان با کد"})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", PriceIRR: 300_000, WithAsset: true})
	f.coupon("FREE100", "percent", 100, 0, 0, 1)
	// Deliberately no wallet credit: the user has nothing, and should
	// still be able to redeem a 100% code.

	result, err := svc.Purchase(ctx, userID,
		[]commerce.PurchaseLine{{AudioEditionID: editionID}}, "FREE100", "")
	require.NoError(t, err)

	require.Equal(t, int64(0), result.Order.TotalIRR)
	require.Len(t, result.Entitlements, 1)
	require.Equal(t, 0, f.countRows("commerce.wallet_ledger", "user_id = $1", userID))
}

// Gifting is the same money movement with the entitlement landing
// elsewhere — which is exactly why 08-decisions.md keeps Entitlement
// separate from the purchase transaction.
func TestGiftPurchaseGrantsToRecipient(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	buyerID := f.user("09120000007")
	recipientID := f.user("09120000008")
	bookID := f.book(bookOpts{Slug: "gift-book", Title: "هدیه"})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", PriceIRR: 200_000, WithAsset: true})
	f.creditWallet(buyerID, 500_000)

	result, err := svc.Purchase(ctx, buyerID, []commerce.PurchaseLine{{
		AudioEditionID:  editionID,
		RecipientUserID: recipientID,
		GiftMessage:     "تولدت مبارک",
	}}, "", "")
	require.NoError(t, err)

	require.Equal(t, commerce.EntitlementOriginGift, result.Entitlements[0].Origin)
	require.Equal(t, int64(300_000), f.walletBalance(buyerID), "the buyer pays")

	recipientEntitled, err := svc.IsEntitledToEdition(ctx, recipientID, editionID, bookID)
	require.NoError(t, err)
	require.True(t, recipientEntitled, "the recipient can play it")

	buyerEntitled, err := svc.IsEntitledToEdition(ctx, buyerID, editionID, bookID)
	require.NoError(t, err)
	require.False(t, buyerEntitled, "the buyer bought it for someone else, not for themselves")
}

// Gateways retry callbacks. Every layer here is built for the callback
// arriving more than once.
func TestTopUpSettlesExactlyOnce(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000009")

	started, err := svc.StartTopUp(ctx, userID, 500_000, "http://localhost/callback", "09120000009")
	require.NoError(t, err)
	require.NotEmpty(t, started.Authority)
	require.Equal(t, int64(0), f.walletBalance(userID), "starting a payment credits nothing")

	first, err := svc.SettleTopUp(ctx, "stub", started.Authority)
	require.NoError(t, err)
	require.Equal(t, commerce.PaymentSucceeded, first.Status)
	require.Equal(t, int64(500_000), f.walletBalance(userID))

	for range 3 {
		repeat, err := svc.SettleTopUp(ctx, "stub", started.Authority)
		require.NoError(t, err)
		require.Equal(t, first.ID, repeat.ID)
	}
	require.Equal(t, int64(500_000), f.walletBalance(userID), "duplicate callbacks never double-credit")
	require.Equal(t, 1, f.countRows("commerce.wallet_ledger", "user_id = $1 AND reason = $2", userID, commerce.ReasonTopUp))
}

func TestTopUpRejectsAmountsOutsideBounds(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()
	userID := f.user("09120000010")

	for _, amount := range []int64{0, -1, 9_999, 50_000_001} {
		_, err := svc.StartTopUp(ctx, userID, amount, "http://localhost/cb", "")
		require.ErrorIs(t, err, commerce.ErrAmountInvalid, "amount %d", amount)
	}
}

// stubListening lets the refund rule be tested without library.
type stubListening struct{ seconds int64 }

func (s stubListening) SecondsListenedForEdition(ctx context.Context, userID, editionID string) (int64, error) {
	return s.seconds, nil
}

func TestRefundPolicy(t *testing.T) {
	t.Run("a barely-listened order inside the window is refundable", func(t *testing.T) {
		svc, f := newCommerceService(t, stubListening{seconds: 60}) // 60s of 600s = 10%
		ctx := context.Background()

		userID := f.user("09120000011")
		bookID := f.book(bookOpts{Slug: "refundable", Title: "قابل بازگشت"})
		editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", PriceIRR: 300_000, DurationSeconds: 600, WithAsset: true})
		f.creditWallet(userID, 500_000)

		purchased, err := svc.Purchase(ctx, userID, []commerce.PurchaseLine{{AudioEditionID: editionID}}, "", "")
		require.NoError(t, err)
		require.Equal(t, int64(200_000), f.walletBalance(userID))

		refund, err := svc.RequestRefund(ctx, userID, purchased.Order.ID, "پسندم نشد")
		require.NoError(t, err)
		require.Equal(t, "requested", refund.Status)

		adminID := f.user("09120009999")
		resolved, err := svc.ApproveRefund(ctx, adminID, refund.ID)
		require.NoError(t, err)
		require.Equal(t, "approved", resolved.Status)

		// The refund credits the wallet rather than reversing to the
		// card: gateway reversals in Iran are slow and manual, and the
		// append-only ledger keeps both the debit and the credit visible.
		require.Equal(t, int64(500_000), f.walletBalance(userID))

		entitled, err := svc.IsEntitledToEdition(ctx, userID, editionID, bookID)
		require.NoError(t, err)
		require.False(t, entitled, "a refunded book is no longer playable")
	})

	t.Run("an order listened past the threshold is not refundable", func(t *testing.T) {
		// 300s of 600s = 50%, well over the 20% ceiling. This is the
		// rule that separates a refund from free consumption.
		svc, f := newCommerceService(t, stubListening{seconds: 300})
		ctx := context.Background()

		userID := f.user("09120000012")
		bookID := f.book(bookOpts{Slug: "consumed", Title: "شنیده‌شده"})
		editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", PriceIRR: 300_000, DurationSeconds: 600, WithAsset: true})
		f.creditWallet(userID, 500_000)

		purchased, err := svc.Purchase(ctx, userID, []commerce.PurchaseLine{{AudioEditionID: editionID}}, "", "")
		require.NoError(t, err)

		_, err = svc.RequestRefund(ctx, userID, purchased.Order.ID, "")
		require.ErrorIs(t, err, commerce.ErrRefundNotEligible)
	})

	t.Run("another user cannot refund someone else's order", func(t *testing.T) {
		svc, f := newCommerceService(t, stubListening{seconds: 0})
		ctx := context.Background()

		ownerID := f.user("09120000013")
		strangerID := f.user("09120000014")
		bookID := f.book(bookOpts{Slug: "not-yours", Title: "مال تو نیست"})
		editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", PriceIRR: 100_000, WithAsset: true})
		f.creditWallet(ownerID, 200_000)

		purchased, err := svc.Purchase(ctx, ownerID, []commerce.PurchaseLine{{AudioEditionID: editionID}}, "", "")
		require.NoError(t, err)

		_, err = svc.RequestRefund(ctx, strangerID, purchased.Order.ID, "")
		require.ErrorIs(t, err, commerce.ErrNotFound)
	})
}

func TestSubscriptionGrantsCatalogWideAccessUntilTheHourCap(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000015")
	f.subscriptionPlan("basic_15h", 1_500_000, 30, 15)
	f.creditWallet(userID, 2_000_000)

	bookID := f.book(bookOpts{Slug: "sub-book", Title: "کتاب اشتراکی"})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", PriceIRR: 400_000, WithAsset: true})

	before, err := svc.IsEntitledToEdition(ctx, userID, editionID, bookID)
	require.NoError(t, err)
	require.False(t, before)

	sub, err := svc.Subscribe(ctx, userID, "basic_15h", false)
	require.NoError(t, err)
	require.Equal(t, "active", sub.Status)
	require.Equal(t, int64(500_000), f.walletBalance(userID))

	t.Run("a subscriber can play a paid title they never bought", func(t *testing.T) {
		entitled, err := svc.IsEntitledToEdition(ctx, userID, editionID, bookID)
		require.NoError(t, err)
		require.True(t, entitled)
	})

	t.Run("access stops once the monthly hour cap is spent", func(t *testing.T) {
		// "Unlimited" only attracts the heaviest listeners and eats the
		// margin (02-business.md), so the cap has to actually bite.
		require.NoError(t, svc.RecordSubscriptionUsage(ctx, userID, 15*3600))

		entitled, err := svc.IsEntitledToEdition(ctx, userID, editionID, bookID)
		require.NoError(t, err)
		require.False(t, entitled)
	})

	t.Run("subscribing again extends rather than stacking", func(t *testing.T) {
		f.creditWallet(userID, 2_000_000)
		extended, err := svc.Subscribe(ctx, userID, "basic_15h", false)
		require.NoError(t, err)
		require.Equal(t, sub.ID, extended.ID, "the same subscription is extended")
		require.Equal(t, 1, f.countRows("commerce.subscriptions", "user_id = $1", userID))
	})
}

func TestSubscribeWithoutFundsChangesNothing(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000016")
	f.subscriptionPlan("plus_30h", 2_600_000, 30, 30)
	f.creditWallet(userID, 100_000)

	_, err := svc.Subscribe(ctx, userID, "plus_30h", false)
	require.ErrorIs(t, err, commerce.ErrInsufficientFunds)

	require.Equal(t, int64(100_000), f.walletBalance(userID))
	require.Equal(t, 0, f.countRows("commerce.subscriptions", "user_id = $1", userID),
		"a subscription must not exist if it was never paid for")
}

func TestExpireDueSubscriptions(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000017")
	planID := f.subscriptionPlan("basic_15h", 0, 30, 15)

	_, err := f.pool.Exec(ctx, `
		INSERT INTO commerce.subscriptions (user_id, plan_id, expires_at)
		VALUES ($1, $2, now() - interval '1 day')`, userID, planID)
	require.NoError(t, err)

	// Lazy expiry alone is not enough: the weekly report, the renewal
	// reminder and every revenue report read status, so 'expired' has to
	// actually be written.
	n, err := svc.ExpireDueSubscriptions(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, n)
	require.Equal(t, 1, f.countRows("commerce.subscriptions", "user_id = $1 AND status = 'expired'", userID))

	_, err = svc.ActiveSubscription(ctx, userID)
	require.ErrorIs(t, err, commerce.ErrNotFound)
}

func TestOrgEntitlementExpires(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000018")
	bookID := f.book(bookOpts{Slug: "school-book", Title: "کتاب درسی"})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", PriceIRR: 500_000, WithAsset: true})

	// School and university seats are nothing but an Entitlement with a
	// different origin and an expiry (08-decisions.md). At price zero
	// this is also the free-schools programme, with no separate path.
	future := time.Now().Add(24 * time.Hour)
	_, err := svc.GrantOrgAccess(ctx, userID, bookID, &future, "")
	require.NoError(t, err)

	entitled, err := svc.IsEntitledToEdition(ctx, userID, editionID, bookID)
	require.NoError(t, err)
	require.True(t, entitled, "an org grant on the book covers its editions")

	past := time.Now().Add(-time.Hour)
	_, err = f.pool.Exec(ctx, `UPDATE commerce.entitlements SET expires_at = $1 WHERE user_id = $2`, past, userID)
	require.NoError(t, err)

	entitled, err = svc.IsEntitledToEdition(ctx, userID, editionID, bookID)
	require.NoError(t, err)
	require.False(t, entitled, "an expired seat grants nothing")
}

// The bug this test pins: renewal used to look only one hour ahead at
// rows still marked 'active', while a separate hourly job expired
// anything past its date. If the worker was down — or if the expiry job
// simply ran first — an auto-renewing subscription slipped past the
// renewal sweep, went to 'expired', and was never seen again. A user who
// had asked for auto-renewal lost access silently.
func TestOverdueSubscriptionIsStillRenewedAfterAMissedRun(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000700")
	planID := f.subscriptionPlan("basic_15h", 1_500_000, 30, 15)
	f.creditWallet(userID, 3_000_000)

	// A subscription that came due six hours ago, while the worker was
	// down, and that a previous expiry sweep has already marked expired.
	var subID string
	require.NoError(t, f.pool.QueryRow(ctx, `
		INSERT INTO commerce.subscriptions (user_id, plan_id, expires_at, auto_renew_from_wallet, status)
		VALUES ($1, $2, now() - interval '6 hours', true, 'expired')
		RETURNING id`, userID, planID).Scan(&subID))

	t.Run("without a grace window the subscription is invisible", func(t *testing.T) {
		// This is the old behaviour, kept as a demonstration: look only
		// forward, and an overdue row is simply never found again.
		noGrace := commerce.RenewalWindow{LookaheadHours: 1, GraceHours: 0, RetryAfterHours: 6}

		result, err := svc.ReconcileSubscriptions(ctx, noGrace)
		require.NoError(t, err)
		require.Equal(t, 0, result.Renewed, "the missed renewal is lost, silently")
		require.Equal(t, int64(3_000_000), f.walletBalance(userID))
	})

	result, err := svc.ReconcileSubscriptions(ctx, commerce.DefaultRenewalWindow)
	require.NoError(t, err)
	require.Equal(t, 1, result.Renewed, "a missed run is recovered, not written off")

	t.Run("the user is charged and back to active", func(t *testing.T) {
		require.Equal(t, int64(1_500_000), f.walletBalance(userID))

		sub, err := svc.ActiveSubscription(ctx, userID)
		require.NoError(t, err)
		require.Equal(t, subID, sub.ID)
		require.Equal(t, "active", sub.Status,
			"paying and still having no access would be the worst of both outcomes")
		require.True(t, sub.ExpiresAt.After(time.Now()))
	})
}

func TestReconcileDoesNotRetryAnEmptyWalletEveryRun(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000701")
	planID := f.subscriptionPlan("plus_30h", 2_600_000, 30, 30)
	// Deliberately no credit: the renewal cannot succeed.

	_, err := f.pool.Exec(ctx, `
		INSERT INTO commerce.subscriptions (user_id, plan_id, expires_at, auto_renew_from_wallet)
		VALUES ($1, $2, now() + interval '30 minutes', true)`, userID, planID)
	require.NoError(t, err)

	first, err := svc.ReconcileSubscriptions(ctx, commerce.DefaultRenewalWindow)
	require.NoError(t, err)
	require.Equal(t, 1, first.InsufficientFunds, "an empty wallet is an expected outcome, not a failure")
	require.Equal(t, 0, first.Failed)

	// The sweep runs every fifteen minutes. Without a backoff it would
	// poke the same empty wallet ninety-six times a day and bury real
	// failures in the log.
	second, err := svc.ReconcileSubscriptions(ctx, commerce.DefaultRenewalWindow)
	require.NoError(t, err)
	require.Equal(t, 0, second.InsufficientFunds, "the retry is deferred, not repeated immediately")
}

// Renewal and expiry used to be two scheduled jobs that raced. Running
// them in one handler, in order, removes the race rather than hoping the
// scheduler fires them helpfully.
func TestReconcileRenewsBeforeItExpires(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	renewing := f.user("09120000702")
	lapsing := f.user("09120000703")
	planID := f.subscriptionPlan("basic_15h", 500_000, 30, 15)

	f.creditWallet(renewing, 1_000_000)
	_, err := f.pool.Exec(ctx, `
		INSERT INTO commerce.subscriptions (user_id, plan_id, expires_at, auto_renew_from_wallet)
		VALUES ($1, $2, now() - interval '10 minutes', true)`, renewing, planID)
	require.NoError(t, err)

	// No auto-renew: this one is genuinely over and should expire.
	_, err = f.pool.Exec(ctx, `
		INSERT INTO commerce.subscriptions (user_id, plan_id, expires_at, auto_renew_from_wallet)
		VALUES ($1, $2, now() - interval '10 minutes', false)`, lapsing, planID)
	require.NoError(t, err)

	result, err := svc.ReconcileSubscriptions(ctx, commerce.DefaultRenewalWindow)
	require.NoError(t, err)
	require.Equal(t, 1, result.Renewed)
	require.Equal(t, 1, result.Expired)

	_, err = svc.ActiveSubscription(ctx, renewing)
	require.NoError(t, err, "the renewing subscriber keeps access")

	_, err = svc.ActiveSubscription(ctx, lapsing)
	require.ErrorIs(t, err, commerce.ErrNotFound, "the one nobody asked to renew lapses")
}

// A subscription far outside the grace window is not silently charged
// months later — at that point it is a new purchase decision, not a
// recovery.
func TestRenewalGraceWindowHasALimit(t *testing.T) {
	svc, f := newCommerceService(t, nil)
	ctx := context.Background()

	userID := f.user("09120000704")
	planID := f.subscriptionPlan("basic_15h", 500_000, 30, 15)
	f.creditWallet(userID, 1_000_000)

	_, err := f.pool.Exec(ctx, `
		INSERT INTO commerce.subscriptions (user_id, plan_id, expires_at, auto_renew_from_wallet, status)
		VALUES ($1, $2, now() - interval '30 days', true, 'expired')`, userID, planID)
	require.NoError(t, err)

	result, err := svc.ReconcileSubscriptions(ctx, commerce.DefaultRenewalWindow)
	require.NoError(t, err)
	require.Equal(t, 0, result.Renewed)
	require.Equal(t, int64(1_000_000), f.walletBalance(userID), "no surprise charge a month later")
}
