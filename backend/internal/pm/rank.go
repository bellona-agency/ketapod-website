package pm

import "strings"

// Manual ordering on the board and the backlog.
//
// The obvious design — an integer position column — makes dragging one
// card an UPDATE over every card below it, and two people dragging at
// once produce a deadlock or a silently wrong order. Instead each issue
// carries a string key, and moving a card means computing a string that
// sorts between its two new neighbours. One row changes, and two
// concurrent moves cannot corrupt each other's rows.
//
// The alphabet is deliberately '0'..'z' minus nothing: any byte in that
// range is legal, comparison is plain lexicographic, and Postgres orders
// it the same way Go does as long as the column is compared with the C
// collation semantics of a pure-ASCII string. Keys only ever grow when
// the gap between neighbours is exhausted, which for a human dragging
// cards happens after tens of thousands of moves in the same slot.
const (
	rankMin  = byte('0')
	rankMax  = byte('z')
	rankMid  = byte('U') // roughly halfway between '0' (48) and 'z' (122)
	rankBase = "U"
)

// RankBetween returns a key that sorts strictly after prev and strictly
// before next. An empty prev means "before everything"; an empty next
// means "after everything".
//
// The result is never equal to either bound, so callers can rely on a
// strict ordering even when they drag a card into a one-slot gap.
func RankBetween(prev, next string) string {
	switch {
	case prev == "" && next == "":
		return rankBase
	case prev == "":
		return rankBefore(next)
	case next == "":
		return rankAfter(prev)
	}

	if prev >= next {
		// Callers pass neighbours read from the database; if they are
		// out of order the data is already wrong and inventing a key
		// between them would hide it. Appending keeps the move
		// deterministic and leaves the ordering repairable.
		return rankAfter(prev)
	}
	return rankMidpoint(prev, next)
}

// InitialRanks produces n keys in order, spread across the space rather
// than packed together, so the first drag into a freshly seeded list
// still has room between any two cards.
func InitialRanks(n int) []string {
	if n <= 0 {
		return nil
	}
	out := make([]string, 0, n)
	span := int(rankMax-rankMin) + 1
	for i := range n {
		// (i+1)/(n+1) of the way through the alphabet: never the first
		// or last byte, so both ends stay open for prepend and append.
		offset := (i + 1) * span / (n + 1)
		if offset >= span {
			offset = span - 1
		}
		out = append(out, string([]byte{rankMin + byte(offset)}))
	}
	return out
}

func rankBefore(next string) string {
	first := byteAt(next, 0)
	if first > rankMin+1 {
		return string([]byte{rankMin + (first-rankMin)/2})
	}
	// The head is already at the bottom of the alphabet, so go deeper:
	// "0" + something is below "0X" for every X.
	return rankMidpoint(string(rankMin), next)
}

func rankAfter(prev string) string {
	last := byteAt(prev, len(prev)-1)
	if last < rankMax-1 {
		return prev[:len(prev)-1] + string([]byte{last + (rankMax-last)/2})
	}
	return prev + rankBase
}

// rankMidpoint walks both keys byte by byte, copying the shared prefix,
// and stops as soon as there is room for a byte strictly between them.
// When there is no room at any position it borrows a character — the
// string grows by one and the gap reopens.
func rankMidpoint(prev, next string) string {
	var b strings.Builder
	for i := 0; ; i++ {
		p := byteAt(prev, i)
		n := byteAtDefault(next, i, rankMax+1)

		if p == n {
			b.WriteByte(p)
			continue
		}
		if n-p > 1 {
			b.WriteByte(p + (n-p)/2)
			return b.String()
		}

		// Adjacent bytes: keep prev's byte and continue past the end of
		// next, where the whole alphabet is available again.
		b.WriteByte(p)
		return b.String() + rankAfterTail(prev, i+1)
	}
}

// rankAfterTail returns a key that sorts after prev's remaining tail,
// used when the midpoint walk had to borrow a character.
func rankAfterTail(prev string, from int) string {
	if from >= len(prev) {
		return rankBase
	}
	return rankAfter(prev[from:])
}

func byteAt(s string, i int) byte {
	return byteAtDefault(s, i, rankMin)
}

func byteAtDefault(s string, i int, def byte) byte {
	if i < 0 || i >= len(s) {
		return def
	}
	c := s[i]
	if c < rankMin || c > rankMax {
		return def
	}
	return c
}
