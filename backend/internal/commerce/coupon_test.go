package commerce_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"ketapod/internal/commerce"
)

// Coupon arithmetic is the one piece of money logic with no I/O, so it
// gets exhaustive table coverage. Every row here is a rule someone could
// plausibly "simplify" later into a bug that hands out rial.
func TestCouponDiscount(t *testing.T) {
	tests := []struct {
		name     string
		coupon   commerce.Coupon
		subtotal int64
		want     int64
	}{
		{
			name:     "percent takes its share",
			coupon:   commerce.Coupon{Kind: commerce.CouponPercent, Value: 20},
			subtotal: 450_000,
			want:     90_000,
		},
		{
			name:     "percent rounds down, never up",
			coupon:   commerce.Coupon{Kind: commerce.CouponPercent, Value: 33},
			subtotal: 1_000,
			want:     330, // 333.33 truncated: the house never over-discounts
		},
		{
			name:     "percent respects the absolute cap",
			coupon:   commerce.Coupon{Kind: commerce.CouponPercent, Value: 50, MaxDiscountIRR: 100_000},
			subtotal: 1_000_000,
			want:     100_000,
		},
		{
			name:     "fixed amount applies as-is",
			coupon:   commerce.Coupon{Kind: commerce.CouponFixed, Value: 75_000},
			subtotal: 450_000,
			want:     75_000,
		},
		{
			name:     "fixed amount larger than the order makes it free, not negative",
			coupon:   commerce.Coupon{Kind: commerce.CouponFixed, Value: 900_000},
			subtotal: 450_000,
			want:     450_000,
		},
		{
			name:     "below the minimum subtotal the coupon does nothing",
			coupon:   commerce.Coupon{Kind: commerce.CouponPercent, Value: 50, MinSubtotalIRR: 500_000},
			subtotal: 400_000,
			want:     0,
		},
		{
			name:     "exactly at the minimum subtotal it applies",
			coupon:   commerce.Coupon{Kind: commerce.CouponPercent, Value: 10, MinSubtotalIRR: 400_000},
			subtotal: 400_000,
			want:     40_000,
		},
		{
			name:     "unknown kind is worth nothing rather than everything",
			coupon:   commerce.Coupon{Kind: "buy_one_get_one", Value: 100},
			subtotal: 450_000,
			want:     0,
		},
		{
			name:     "a 100 percent coupon makes the order free",
			coupon:   commerce.Coupon{Kind: commerce.CouponPercent, Value: 100},
			subtotal: 450_000,
			want:     450_000,
		},
		{
			name:     "a percent over 100 still cannot exceed the subtotal",
			coupon:   commerce.Coupon{Kind: commerce.CouponPercent, Value: 150},
			subtotal: 450_000,
			want:     450_000,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, tc.coupon.Discount(tc.subtotal))
		})
	}
}

func TestSubscriptionCapacity(t *testing.T) {
	plan := &commerce.SubscriptionPlan{MonthlyHourCap: 15}

	t.Run("under the cap it grants access", func(t *testing.T) {
		sub := commerce.Subscription{Plan: plan, HoursConsumed: 14.9}
		require.True(t, sub.HasCapacity())
	})

	t.Run("exactly at the cap it stops", func(t *testing.T) {
		sub := commerce.Subscription{Plan: plan, HoursConsumed: 15}
		require.False(t, sub.HasCapacity())
	})

	t.Run("with no plan loaded it grants nothing", func(t *testing.T) {
		// Fail closed: a subscription whose plan failed to load must not
		// be read as unlimited access.
		sub := commerce.Subscription{HoursConsumed: 0}
		require.False(t, sub.HasCapacity())
	})
}
