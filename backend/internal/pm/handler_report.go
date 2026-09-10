package pm

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"ketapod/internal/platform/httpkit"
)

// burndown defaults to the active sprint, because that is the one
// anybody standing in front of the chart is asking about.
func (h *Handler) burndown(w http.ResponseWriter, r *http.Request) {
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}

	sprintID := httpkit.QueryString(r, "sprintId")
	if sprintID == "" {
		if project.ActiveSprint == nil {
			httpkit.JSON(w, http.StatusOK, map[string]any{"sprint": nil, "points": []BurndownPoint{}})
			return
		}
		sprintID = project.ActiveSprint.ID
	}

	report, err := h.svc.Burndown(r.Context(), sprintID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, report)
}

func (h *Handler) velocity(w http.ResponseWriter, r *http.Request) {
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}

	limit, _ := strconv.Atoi(httpkit.QueryString(r, "limit"))
	entries, err := h.svc.Velocity(r.Context(), project.ID, limit)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if entries == nil {
		entries = []VelocityEntry{}
	}

	// The average is computed here rather than in the client so every
	// surface that shows "the team's velocity" shows the same number.
	var sum float64
	for _, e := range entries {
		sum += e.Completed
	}
	average := 0.0
	if len(entries) > 0 {
		average = sum / float64(len(entries))
	}

	httpkit.JSON(w, http.StatusOK, map[string]any{"items": entries, "average": average})
}

func (h *Handler) workload(w http.ResponseWriter, r *http.Request) {
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}

	to := time.Now()
	from := to.AddDate(0, 0, -14)
	if v := parseTimePtr(httpkit.QueryStringPtr(r, "from")); v != nil {
		from = *v
	}
	if v := parseTimePtr(httpkit.QueryStringPtr(r, "to")); v != nil {
		to = *v
	}

	entries, err := h.svc.Workload(r.Context(), project.ID, from, to)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{
		"items": entries,
		"from":  from.Format(time.RFC3339),
		"to":    to.Format(time.RFC3339),
	})
}

func (h *Handler) cycleTime(w http.ResponseWriter, r *http.Request) {
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}

	days, _ := strconv.Atoi(httpkit.QueryString(r, "days"))
	report, err := h.svc.CycleTime(r.Context(), project.ID, days)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, report)
}
