package pm

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestExtractMentions(t *testing.T) {
	const sina = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
	const iman = "8a1b0c9d-2e3f-4a5b-8c7d-6e5f4a3b2c1d"

	body := "@[سینا راضی](" + sina + ") لطفاً با @[ایمان نیک‌نام](" + iman + ") چک کن. " +
		"دوباره @[سینا راضی](" + sina + ")"

	require.Equal(t, []string{sina, iman}, ExtractMentions(body))
}

func TestExtractMentionsIgnoresGarbage(t *testing.T) {
	// An email address, a bare at-sign and a malformed id must all pass
	// through without producing a notification — or pasting a log line
	// into a comment would ping the team.
	require.Nil(t, ExtractMentions("بفرست به sina@ketapod.ir و @everyone"))
	require.Nil(t, ExtractMentions("@[کسی](not-a-uuid-at-all-but-36-chars!!)"))
	require.Nil(t, ExtractMentions(""))
}

func TestPlainTextStripsMarkup(t *testing.T) {
	body := "@[سینا راضی](3f2504e0-4f89-41d3-9a0c-0305e82c3301) این را ببین"
	require.Equal(t, "@سینا راضی این را ببین", PlainText(body))
}
