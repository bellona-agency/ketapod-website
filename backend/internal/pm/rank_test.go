package pm

import (
	"math/rand"
	"sort"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRankBetweenIsStrictlyOrdered(t *testing.T) {
	cases := []struct{ prev, next string }{
		{"", ""},
		{"", "U"},
		{"U", ""},
		{"U", "V"},
		{"U", "UV"},
		{"0", "1"},
		{"y", "z"},
		{"0", "z"},
		{"UUUU", "UUUV"},
	}

	for _, c := range cases {
		got := RankBetween(c.prev, c.next)
		if c.prev != "" {
			require.Greater(t, got, c.prev, "prev=%q next=%q", c.prev, c.next)
		}
		if c.next != "" {
			require.Less(t, got, c.next, "prev=%q next=%q", c.prev, c.next)
		}
	}
}

func TestInitialRanksAreAscendingAndLeaveRoomAtBothEnds(t *testing.T) {
	for _, n := range []int{1, 2, 5, 50} {
		ranks := InitialRanks(n)
		require.Len(t, ranks, n)
		require.True(t, sort.StringsAreSorted(ranks), "n=%d not sorted: %v", n, ranks)

		// Both ends must stay open, or the first "move to top" has
		// nowhere to go.
		require.Greater(t, RankBetween("", ranks[0]), "")
		require.Less(t, RankBetween("", ranks[0]), ranks[0])
		require.Greater(t, RankBetween(ranks[n-1], ""), ranks[n-1])
	}
}

// The failure this guards against is the one that matters in practice:
// not a single bad midpoint, but a list that degrades after many drags
// into the same gap until two cards end up with equal keys and the board
// starts flickering between two orders.
func TestRepeatedInsertionIntoTheSameGapKeepsOrder(t *testing.T) {
	list := InitialRanks(2)

	for range 500 {
		mid := RankBetween(list[0], list[1])
		require.Greater(t, mid, list[0])
		require.Less(t, mid, list[1])
		list = []string{list[0], mid}
	}
}

func TestRandomDragsPreserveTotalOrder(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	list := InitialRanks(20)

	for range 2000 {
		from := rng.Intn(len(list))
		card := list[from]
		list = append(list[:from], list[from+1:]...)

		to := rng.Intn(len(list) + 1)
		var prev, next string
		if to > 0 {
			prev = list[to-1]
		}
		if to < len(list) {
			next = list[to]
		}
		card = RankBetween(prev, next)

		list = append(list, "")
		copy(list[to+1:], list[to:])
		list[to] = card

		require.True(t, sort.StringsAreSorted(list), "order broke: %v", list)
		for i := 1; i < len(list); i++ {
			require.NotEqual(t, list[i-1], list[i], "duplicate rank: %v", list)
		}
	}
}
