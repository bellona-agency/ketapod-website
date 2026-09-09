package media

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// ErrRangeOutsidePreview is returned when a preview listener asks for
// bytes past the preview window. It maps to 416 Range Not Satisfiable,
// which is what an audio player understands — a 403 here makes players
// retry in a loop instead of stopping.
var ErrRangeOutsidePreview = errors.New("media: requested range is outside the preview window")

// clampRange narrows an HTTP Range header so it can never read past
// limit-1.
//
// Cases, all of which a real audio player produces:
//   - no Range at all -> ask storage for bytes 0..limit-1 (the player
//     gets a short file and stops there)
//   - "bytes=0-"      -> open-ended from the start, clamp the end
//   - "bytes=100-500" -> clamp the end if it overshoots
//   - "bytes=-500"    -> suffix range: the last N bytes of the *file*,
//     which for a preview would be past the window, so it is refused
//   - start >= limit  -> refused
//
// Multi-range requests ("bytes=0-10,20-30") are refused rather than
// partially honoured; no audio element sends them and silently serving
// the first part would be worse than an explicit error.
func clampRange(rangeHeader string, limit int64) (string, error) {
	if limit <= 0 {
		return "", ErrRangeOutsidePreview
	}

	if rangeHeader == "" {
		return fmt.Sprintf("bytes=0-%d", limit-1), nil
	}

	spec, ok := strings.CutPrefix(strings.TrimSpace(rangeHeader), "bytes=")
	if !ok {
		return "", ErrRangeOutsidePreview
	}
	if strings.Contains(spec, ",") {
		return "", ErrRangeOutsidePreview
	}

	startRaw, endRaw, ok := strings.Cut(spec, "-")
	if !ok {
		return "", ErrRangeOutsidePreview
	}

	if startRaw == "" {
		// Suffix range: the last N bytes of the whole object. Inside a
		// preview that always lands outside the window.
		return "", ErrRangeOutsidePreview
	}

	start, err := strconv.ParseInt(startRaw, 10, 64)
	if err != nil || start < 0 {
		return "", ErrRangeOutsidePreview
	}
	if start >= limit {
		return "", ErrRangeOutsidePreview
	}

	end := limit - 1
	if endRaw != "" {
		parsed, err := strconv.ParseInt(endRaw, 10, 64)
		if err != nil || parsed < start {
			return "", ErrRangeOutsidePreview
		}
		end = min(parsed, limit-1)
	}

	return fmt.Sprintf("bytes=%d-%d", start, end), nil
}
