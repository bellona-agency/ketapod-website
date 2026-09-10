package pm

import (
	"regexp"

	"github.com/google/uuid"
)

// Mentions.
//
// The wire format is `@[نام کامل](member-uuid)`, written by the
// composer's autocomplete rather than typed by hand. The obvious
// alternative — matching a bare `@name` against the member list — does
// not survive Persian names: they contain spaces, so there is no way to
// tell where the mention ends, and two teammates called «علی» would make
// the notification a coin flip. Carrying the id means the mention keeps
// pointing at the right person after a rename, and rendering can fall
// back to the stored display name if the account is gone.
var mentionPattern = regexp.MustCompile(`@\[[^\]\n]{1,80}\]\(([0-9a-fA-F-]{36})\)`)

// ExtractMentions returns the distinct member ids mentioned in body, in
// the order they first appear. Malformed ids are skipped rather than
// reported: a comment must never fail to post because someone pasted
// text that happened to look like a mention.
func ExtractMentions(body string) []string {
	matches := mentionPattern.FindAllStringSubmatch(body, -1)
	if len(matches) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(matches))
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		parsed, err := uuid.Parse(m[1])
		if err != nil {
			continue
		}
		id := parsed.String()
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// PlainText strips the mention markup down to the display names, for
// the places a notification body has no renderer — an email subject, a
// push payload, the one-line preview in the notification list.
func PlainText(body string) string {
	return mentionPattern.ReplaceAllStringFunc(body, func(match string) string {
		start, end := 2, len(match)
		for i := 2; i < len(match); i++ {
			if match[i] == ']' {
				end = i
				break
			}
		}
		return "@" + match[start:end]
	})
}
