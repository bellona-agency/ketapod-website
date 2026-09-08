package catalog_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"ketapod/internal/catalog"
)

// Persian text typed on three different keyboards produces three
// different byte sequences for the same word. Without folding them,
// "کتاب" typed with an Arabic kaf never matches "کتاب" stored with a
// Persian one, and the user concludes we do not have the book.
//
// The same folding exists in SQL as catalog.normalize_fa so the index
// and the query agree; this table pins the Go half of that contract.
func TestNormalizePersian(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "Arabic yeh folds to Persian yeh",
			input: "مديريت",
			want:  "مدیریت",
		},
		{
			name:  "Arabic kaf folds to Persian kaf",
			input: "كتاب",
			want:  "کتاب",
		},
		{
			name:  "alef maksura folds to Persian yeh",
			input: "علی",
			want:  "علی",
		},
		{
			name:  "the zero-width non-joiner becomes a space",
			input: "قصه‌های",
			want:  "قصه های",
		},
		{
			name:  "Persian digits fold to ASCII",
			input: "۱۲۳",
			want:  "123",
		},
		{
			name:  "Arabic-Indic digits fold to ASCII",
			input: "٤٥٦",
			want:  "456",
		},
		{
			name:  "harakat are stripped",
			input: "کِتاب",
			want:  "کتاب",
		},
		{
			name:  "bidi marks are removed entirely",
			input: "کتاب‏",
			want:  "کتاب",
		},
		{
			name:  "runs of whitespace collapse",
			input: "  قصه    شب  ",
			want:  "قصه شب",
		},
		{
			name:  "already-normal text is left alone",
			input: "قصه شب",
			want:  "قصه شب",
		},
		{
			name:  "latin text passes through",
			input: "Bedtime Stories",
			want:  "Bedtime Stories",
		},
		{
			name:  "empty input stays empty",
			input: "",
			want:  "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, catalog.NormalizePersian(tc.input))
		})
	}
}

func TestNormalizePersianIsIdempotent(t *testing.T) {
	// Both the Go query path and the SQL index path apply the fold, so
	// a query can be normalized twice. That must be harmless.
	for _, input := range []string{"مديريت كتاب", "قصه‌های ۱۲", "  علی  "} {
		once := catalog.NormalizePersian(input)
		require.Equal(t, once, catalog.NormalizePersian(once), "input %q", input)
	}
}

func TestEditionIsFree(t *testing.T) {
	// Free access is "price zero", not a separate kind of thing: school
	// access and promotional titles reuse the paid code path with a zero
	// price rather than getting their own branch.
	require.True(t, catalog.Edition{PriceIRR: 0}.IsFree())
	require.False(t, catalog.Edition{PriceIRR: 1}.IsFree())
}
