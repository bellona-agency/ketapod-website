package pm

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"ketapod/internal/platform/httpkit"
)

type Handler struct {
	svc  *Service
	auth *Authenticator
	log  *slog.Logger
}

func NewHandler(svc *Service, auth *Authenticator, log *slog.Logger) *Handler {
	return &Handler{svc: svc, auth: auth, log: log}
}

// Routes mounts the whole tool.
//
// The shape follows the URLs people paste to each other: a project is
// /projects/KET and an issue is /issues/KET-142, not a pair of uuids.
// Ids appear only where the client already holds one from a previous
// response — a comment it just posted, an attachment it is deleting.
func (h *Handler) Routes(r chi.Router) {
	requireAuth := h.auth.Middleware()

	// Public: everything needed to get a session, and nothing else.
	r.Route("/auth", func(r chi.Router) {
		r.Get("/bootstrap", h.bootstrapStatus)
		r.Post("/bootstrap", h.bootstrap)
		r.Post("/login", h.login)
		r.Post("/refresh", h.refresh)
		r.Post("/logout", h.logout)
		r.Post("/invites/accept", h.acceptInvite)
	})

	r.Group(func(r chi.Router) {
		r.Use(requireAuth)

		r.Get("/me", h.me)
		r.Patch("/me", h.updateProfile)
		r.Post("/me/password", h.changePassword)

		r.Get("/members", h.listMembers)
		r.With(RequireAdmin).Post("/members/invite", h.invite)
		r.With(RequireAdmin).Patch("/members/{memberId}", h.updateMemberAccess)

		r.Get("/projects", h.listProjects)
		r.With(RequireAdmin).Post("/projects", h.createProject)

		r.Route("/projects/{projectKey}", func(r chi.Router) {
			r.Get("/", h.getProject)
			r.With(RequireWrite).Patch("/", h.updateProject)
			r.With(RequireAdmin).Post("/archive", h.archiveProject)

			r.Get("/members", h.listProjectMembers)
			r.With(RequireWrite).Post("/members", h.addProjectMember)
			r.With(RequireWrite).Delete("/members/{memberId}", h.removeProjectMember)

			r.Get("/statuses", h.listStatuses)
			r.With(RequireWrite).Post("/statuses", h.createStatus)
			r.With(RequireWrite).Post("/statuses/reorder", h.reorderStatuses)

			r.Get("/labels", h.listLabels)
			r.With(RequireWrite).Post("/labels", h.createLabel)
			r.With(RequireWrite).Delete("/labels/{labelId}", h.deleteLabel)

			r.Get("/board", h.board)
			r.Get("/backlog", h.backlog)

			r.Get("/sprints", h.listSprints)
			r.With(RequireWrite).Post("/sprints", h.createSprint)

			r.Get("/issues", h.listProjectIssues)
			r.With(RequireWrite).Post("/issues", h.createIssue)

			r.Route("/reports", func(r chi.Router) {
				r.Get("/burndown", h.burndown)
				r.Get("/velocity", h.velocity)
				r.Get("/workload", h.workload)
				r.Get("/cycle-time", h.cycleTime)
			})
		})

		r.With(RequireWrite).Patch("/statuses/{statusId}", h.updateStatus)
		r.With(RequireWrite).Delete("/statuses/{statusId}", h.deleteStatus)

		r.With(RequireWrite).Patch("/sprints/{sprintId}", h.updateSprint)
		r.With(RequireWrite).Post("/sprints/{sprintId}/start", h.startSprint)
		r.With(RequireWrite).Post("/sprints/{sprintId}/complete", h.completeSprint)
		r.With(RequireWrite).Delete("/sprints/{sprintId}", h.deleteSprint)

		r.Get("/issues", h.searchIssues)
		r.Get("/issues/{issueKey}", h.getIssue)
		r.With(RequireWrite).Patch("/issues/{issueId}", h.patchIssue)
		r.With(RequireAdmin).Delete("/issues/{issueId}", h.deleteIssue)
		r.With(RequireWrite).Post("/issues/{issueId}/move", h.moveIssue)
		r.With(RequireWrite).Post("/issues/{issueId}/comments", h.addComment)
		r.With(RequireWrite).Post("/issues/{issueId}/attachments", h.addAttachment)
		r.With(RequireWrite).Post("/issues/{issueId}/worklogs", h.logWork)
		r.With(RequireWrite).Post("/issues/{issueId}/links", h.linkIssues)
		r.Post("/issues/{issueId}/watch", h.watch)

		r.With(RequireWrite).Patch("/comments/{commentId}", h.editComment)
		r.With(RequireWrite).Delete("/comments/{commentId}", h.deleteComment)
		r.Get("/attachments/{attachmentId}", h.downloadAttachment)
		r.With(RequireWrite).Delete("/attachments/{attachmentId}", h.deleteAttachment)
		r.With(RequireWrite).Delete("/worklogs/{worklogId}", h.deleteWorklog)
		r.With(RequireWrite).Delete("/links/{linkId}", h.unlinkIssues)

		r.Get("/timesheet", h.timesheet)

		r.Get("/notifications", h.notifications)
		r.Post("/notifications/read", h.markRead)
		r.Get("/notifications/stream", h.notificationStream)
	})
}

// fail is the single translation from domain errors to HTTP. Handlers
// never choose a status code themselves, so a new error type gets its
// mapping in one place rather than in the twenty handlers that can
// return it.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		httpkit.Error(w, http.StatusNotFound, "not_found", "پیدا نشد")
	case errors.Is(err, ErrForbidden), errors.Is(err, ErrDisabled):
		httpkit.Error(w, http.StatusForbidden, "forbidden", "دسترسی لازم را ندارید")
	case errors.Is(err, ErrUnauthorized):
		httpkit.Error(w, http.StatusUnauthorized, "unauthorized", "نشست معتبر نیست")
	case errors.Is(err, ErrBadPassword):
		httpkit.Error(w, http.StatusUnauthorized, "bad_credentials", "ایمیل یا رمز عبور نادرست است")
	case errors.Is(err, ErrInviteUsed):
		httpkit.Error(w, http.StatusGone, "invite_invalid", "این لینک دعوت منقضی یا استفاده شده است")
	case errors.Is(err, ErrValidation):
		// The message is written for the person reading it, so it is
		// passed through rather than replaced with a generic string.
		httpkit.ValidationError(w, map[string][]string{"body": {trimErrPrefix(err)}})
	case errors.Is(err, ErrConflict):
		httpkit.Error(w, http.StatusConflict, "conflict", "این مقدار قبلاً استفاده شده است")
	case errors.Is(err, httpkit.ErrBadJSON):
		httpkit.BadJSON(w)
	default:
		h.log.ErrorContext(r.Context(), "pm: request failed",
			slog.String("path", r.URL.Path), slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "internal_error", "خطای داخلی سرور")
	}
}

func trimErrPrefix(err error) string {
	msg := err.Error()
	if _, after, found := strings.Cut(msg, ": "); found {
		return after
	}
	return msg
}

// ── auth ───────────────────────────────────────────────────────────────

func (h *Handler) bootstrapStatus(w http.ResponseWriter, r *http.Request) {
	needs, err := h.svc.NeedsBootstrap(r.Context())
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]bool{"needsBootstrap": needs})
}

func (h *Handler) bootstrap(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		FullName string `json:"fullName"`
		Password string `json:"password"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	tokens, err := h.svc.Bootstrap(r.Context(), body.Email, body.FullName, body.Password,
		r.UserAgent(), clientIP(r))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusCreated, tokens)
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	tokens, err := h.svc.Login(r.Context(), body.Email, body.Password, r.UserAgent(), clientIP(r))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, tokens)
}

func (h *Handler) refresh(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refreshToken"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	tokens, err := h.svc.Refresh(r.Context(), body.RefreshToken)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, tokens)
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refreshToken"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	if err := h.svc.Logout(r.Context(), body.RefreshToken); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) acceptInvite(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token    string `json:"token"`
		FullName string `json:"fullName"`
		Password string `json:"password"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	tokens, err := h.svc.AcceptInvite(r.Context(), body.Token, body.FullName, body.Password,
		r.UserAgent(), clientIP(r))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, tokens)
}

// ── members ────────────────────────────────────────────────────────────

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	member, _ := MemberFromContext(r.Context())
	httpkit.JSON(w, http.StatusOK, member)
}

func (h *Handler) updateProfile(w http.ResponseWriter, r *http.Request) {
	member, _ := MemberFromContext(r.Context())
	var body struct {
		FullName string `json:"fullName"`
		Timezone string `json:"timezone"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	updated, err := h.svc.UpdateProfile(r.Context(), member, body.FullName, body.Timezone)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	h.auth.InvalidateMemberCache(r.Context(), member.ID)
	httpkit.JSON(w, http.StatusOK, updated)
}

func (h *Handler) changePassword(w http.ResponseWriter, r *http.Request) {
	member, _ := MemberFromContext(r.Context())
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	if err := h.svc.ChangePassword(r.Context(), member, body.CurrentPassword, body.NewPassword); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) listMembers(w http.ResponseWriter, r *http.Request) {
	member, _ := MemberFromContext(r.Context())
	members, err := h.svc.ListMembers(r.Context(), member)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"items": members})
}

func (h *Handler) invite(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	var body struct {
		Email    string `json:"email"`
		FullName string `json:"fullName"`
		Role     string `json:"role"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	if body.Role == "" {
		body.Role = RoleMember
	}

	result, err := h.svc.Invite(r.Context(), actor, body.Email, body.FullName, body.Role)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusCreated, result)
}

func (h *Handler) updateMemberAccess(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	memberID := chi.URLParam(r, "memberId")

	var body struct {
		Role   string `json:"role"`
		Status string `json:"status"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	updated, err := h.svc.UpdateMemberAccess(r.Context(), actor, memberID, body.Role, body.Status)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	h.auth.InvalidateMemberCache(r.Context(), memberID)
	httpkit.JSON(w, http.StatusOK, updated)
}

// ── projects ───────────────────────────────────────────────────────────

func (h *Handler) listProjects(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	projects, err := h.svc.ListProjects(r.Context(), actor, httpkit.QueryString(r, "archived") == "true")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"items": projects})
}

func (h *Handler) createProject(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	var body struct {
		Key         string `json:"key"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Color       string `json:"color"`
		LeadID      string `json:"leadId"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	project, err := h.svc.CreateProject(r.Context(), actor, NewProject{
		Key: body.Key, Name: body.Name, Description: body.Description,
		Color: body.Color, LeadID: body.LeadID,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusCreated, project)
}

func (h *Handler) getProject(w http.ResponseWriter, r *http.Request) {
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, project)
}

func (h *Handler) updateProject(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}

	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Color       string `json:"color"`
		LeadID      string `json:"leadId"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	updated, err := h.svc.UpdateProject(r.Context(), actor, project.ID, NewProject{
		Name: body.Name, Description: body.Description, Color: body.Color, LeadID: body.LeadID,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, updated)
}

func (h *Handler) archiveProject(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}

	var body struct {
		Archived bool `json:"archived"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	if err := h.svc.SetProjectArchived(r.Context(), actor, project.ID, body.Archived); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) listProjectMembers(w http.ResponseWriter, r *http.Request) {
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	members, err := h.svc.ProjectMembers(r.Context(), project.ID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"items": members})
}

func (h *Handler) addProjectMember(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}

	var body struct {
		MemberID string `json:"memberId"`
		Role     string `json:"role"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	if body.Role == "" {
		body.Role = "member"
	}
	if err := h.svc.AddProjectMember(r.Context(), actor, project.ID, body.MemberID, body.Role); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) removeProjectMember(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if err := h.svc.RemoveProjectMember(r.Context(), actor, project.ID, chi.URLParam(r, "memberId")); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

// ── statuses and labels ────────────────────────────────────────────────

func (h *Handler) listStatuses(w http.ResponseWriter, r *http.Request) {
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	statuses, err := h.svc.Statuses(r.Context(), project.ID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"items": statuses})
}

func (h *Handler) createStatus(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}

	var body struct {
		Name     string `json:"name"`
		Category string `json:"category"`
		Color    string `json:"color"`
		WIPLimit *int   `json:"wipLimit"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	status, err := h.svc.CreateStatus(r.Context(), actor, project.ID, body.Name, body.Category, body.Color, body.WIPLimit)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusCreated, status)
}

func (h *Handler) updateStatus(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	var body struct {
		Name     string `json:"name"`
		Category string `json:"category"`
		Color    string `json:"color"`
		Position int    `json:"position"`
		WIPLimit *int   `json:"wipLimit"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	status, err := h.svc.UpdateStatus(r.Context(), actor, chi.URLParam(r, "statusId"),
		body.Name, body.Category, body.Color, body.Position, body.WIPLimit)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, status)
}

func (h *Handler) deleteStatus(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	if err := h.svc.DeleteStatus(r.Context(), actor, chi.URLParam(r, "statusId"),
		httpkit.QueryString(r, "moveTo")); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) reorderStatuses(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}

	var body struct {
		StatusIDs []string `json:"statusIds"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	statuses, err := h.svc.ReorderStatuses(r.Context(), actor, project.ID, body.StatusIDs)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"items": statuses})
}

func (h *Handler) listLabels(w http.ResponseWriter, r *http.Request) {
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	labels, err := h.svc.Labels(r.Context(), project.ID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"items": labels})
}

func (h *Handler) createLabel(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}

	var body struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	label, err := h.svc.UpsertLabel(r.Context(), actor, project.ID, body.Name, body.Color)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusCreated, label)
}

func (h *Handler) deleteLabel(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if err := h.svc.DeleteLabel(r.Context(), actor, project.ID, chi.URLParam(r, "labelId")); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

// ── board and backlog ──────────────────────────────────────────────────

func (h *Handler) board(w http.ResponseWriter, r *http.Request) {
	board, err := h.svc.Board(r.Context(), chi.URLParam(r, "projectKey"),
		httpkit.QueryString(r, "sprint"), filterFromRequest(r))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, board)
}

func (h *Handler) backlog(w http.ResponseWriter, r *http.Request) {
	backlog, err := h.svc.Backlog(r.Context(), chi.URLParam(r, "projectKey"), filterFromRequest(r))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, backlog)
}

// ── sprints ────────────────────────────────────────────────────────────

func (h *Handler) listSprints(w http.ResponseWriter, r *http.Request) {
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	sprints, err := h.svc.Sprints(r.Context(), project.ID, splitCSV(httpkit.QueryString(r, "state")))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"items": sprints})
}

type sprintBody struct {
	Name     string  `json:"name"`
	Goal     string  `json:"goal"`
	StartsAt *string `json:"startsAt"`
	EndsAt   *string `json:"endsAt"`
}

func (h *Handler) createSprint(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}

	var body sprintBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	sprint, err := h.svc.CreateSprint(r.Context(), actor, project.ID, body.Name, body.Goal,
		parseTimePtr(body.StartsAt), parseTimePtr(body.EndsAt))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusCreated, sprint)
}

func (h *Handler) updateSprint(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	var body sprintBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	sprint, err := h.svc.UpdateSprint(r.Context(), actor, chi.URLParam(r, "sprintId"),
		body.Name, body.Goal, parseTimePtr(body.StartsAt), parseTimePtr(body.EndsAt))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, sprint)
}

func (h *Handler) startSprint(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	sprint, err := h.svc.StartSprint(r.Context(), actor, chi.URLParam(r, "sprintId"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, sprint)
}

func (h *Handler) completeSprint(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	var body struct {
		MoveToSprintID string `json:"moveToSprintId"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	result, err := h.svc.CompleteSprint(r.Context(), actor, chi.URLParam(r, "sprintId"), body.MoveToSprintID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, result)
}

func (h *Handler) deleteSprint(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	if err := h.svc.DeleteSprint(r.Context(), actor, chi.URLParam(r, "sprintId")); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

// ── issues ─────────────────────────────────────────────────────────────

func (h *Handler) searchIssues(w http.ResponseWriter, r *http.Request) {
	filter := filterFromRequest(r)
	page := httpkit.PageFromRequest(r)
	filter.Limit, filter.Offset = page.Limit, page.Offset

	if key := httpkit.QueryString(r, "project"); key != "" {
		project, err := h.svc.Project(r.Context(), key)
		if err != nil {
			h.fail(w, r, err)
			return
		}
		filter.ProjectID = project.ID
	}

	issues, total, err := h.svc.SearchIssues(r.Context(), filter)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.Page200(w, issues, total, page)
}

func (h *Handler) listProjectIssues(w http.ResponseWriter, r *http.Request) {
	project, err := h.svc.Project(r.Context(), chi.URLParam(r, "projectKey"))
	if err != nil {
		h.fail(w, r, err)
		return
	}

	filter := filterFromRequest(r)
	filter.ProjectID = project.ID
	page := httpkit.PageFromRequest(r)
	filter.Limit, filter.Offset = page.Limit, page.Offset

	issues, total, err := h.svc.SearchIssues(r.Context(), filter)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.Page200(w, issues, total, page)
}

func (h *Handler) createIssue(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())

	var body struct {
		Type        string   `json:"type"`
		Title       string   `json:"title"`
		Description string   `json:"description"`
		StatusID    string   `json:"statusId"`
		Priority    string   `json:"priority"`
		AssigneeID  string   `json:"assigneeId"`
		ParentID    string   `json:"parentId"`
		EpicID      string   `json:"epicId"`
		SprintID    string   `json:"sprintId"`
		StoryPoints *float64 `json:"storyPoints"`
		EstimateSec *int     `json:"estimateSeconds"`
		DueAt       *string  `json:"dueAt"`
		LabelIDs    []string `json:"labelIds"`
		LabelNames  []string `json:"labelNames"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	issue, err := h.svc.CreateIssue(r.Context(), actor, NewIssueInput{
		ProjectKey: chi.URLParam(r, "projectKey"),
		Type:       body.Type, Title: body.Title, Description: body.Description,
		StatusID: body.StatusID, Priority: body.Priority, AssigneeID: body.AssigneeID,
		ParentID: body.ParentID, EpicID: body.EpicID, SprintID: body.SprintID,
		StoryPoints: body.StoryPoints, EstimateSec: body.EstimateSec,
		DueAt:    parseTimePtr(body.DueAt),
		LabelIDs: body.LabelIDs, LabelNames: body.LabelNames,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusCreated, issue)
}

func (h *Handler) getIssue(w http.ResponseWriter, r *http.Request) {
	key := strings.ToUpper(chi.URLParam(r, "issueKey"))
	dash := strings.LastIndex(key, "-")
	if dash <= 0 {
		httpkit.Error(w, http.StatusNotFound, "not_found", "کلید ایشیو نامعتبر است")
		return
	}
	number, err := strconv.ParseInt(key[dash+1:], 10, 64)
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "کلید ایشیو نامعتبر است")
		return
	}

	detail, err := h.svc.Issue(r.Context(), key[:dash], number)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, detail)
}

// issuePatchBody uses pointers so "not sent" and "sent as null" stay
// distinguishable after decoding. json.Unmarshal writes nil for an
// explicit null and leaves the field untouched when it is absent, which
// is not enough on its own — the Clear flags below are what the client
// sends to mean "unassign".
type issuePatchBody struct {
	Title       *string   `json:"title"`
	Description *string   `json:"description"`
	Type        *string   `json:"type"`
	Priority    *string   `json:"priority"`
	StatusID    *string   `json:"statusId"`
	AssigneeID  *string   `json:"assigneeId"`
	SprintID    *string   `json:"sprintId"`
	EpicID      *string   `json:"epicId"`
	ParentID    *string   `json:"parentId"`
	StoryPoints *float64  `json:"storyPoints"`
	EstimateSec *int      `json:"estimateSeconds"`
	DueAt       *string   `json:"dueAt"`
	LabelIDs    *[]string `json:"labelIds"`

	ClearAssignee bool `json:"clearAssignee"`
	ClearSprint   bool `json:"clearSprint"`
	ClearEpic     bool `json:"clearEpic"`
	ClearParent   bool `json:"clearParent"`
	ClearDue      bool `json:"clearDue"`
	ClearPoints   bool `json:"clearPoints"`
}

func (h *Handler) patchIssue(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())

	var body issuePatchBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	issue, err := h.svc.UpdateIssue(r.Context(), actor, chi.URLParam(r, "issueId"), IssuePatchInput{
		Title: body.Title, Description: body.Description, Type: body.Type,
		Priority: body.Priority, StatusID: body.StatusID, AssigneeID: body.AssigneeID,
		SprintID: body.SprintID, EpicID: body.EpicID, ParentID: body.ParentID,
		StoryPoints: body.StoryPoints, EstimateSec: body.EstimateSec,
		DueAt: parseTimePtr(body.DueAt), LabelIDs: body.LabelIDs,
		ClearAssignee: body.ClearAssignee, ClearSprint: body.ClearSprint,
		ClearEpic: body.ClearEpic, ClearParent: body.ClearParent,
		ClearDue: body.ClearDue, ClearPoints: body.ClearPoints,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, issue)
}

func (h *Handler) moveIssue(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	var body struct {
		StatusID    string `json:"statusId"`
		AfterID     string `json:"afterId"`
		BeforeID    string `json:"beforeId"`
		SprintID    string `json:"sprintId"`
		ClearSprint bool   `json:"clearSprint"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	issue, err := h.svc.MoveIssue(r.Context(), actor, chi.URLParam(r, "issueId"),
		body.StatusID, body.AfterID, body.BeforeID, body.SprintID, body.ClearSprint)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, issue)
}

func (h *Handler) deleteIssue(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	if err := h.svc.DeleteIssue(r.Context(), actor, chi.URLParam(r, "issueId")); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) linkIssues(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	var body struct {
		Kind      string `json:"kind"`
		TargetKey string `json:"targetKey"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	if err := h.svc.LinkIssues(r.Context(), actor, chi.URLParam(r, "issueId"), body.Kind, body.TargetKey); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) unlinkIssues(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	if err := h.svc.UnlinkIssues(r.Context(), actor, chi.URLParam(r, "linkId")); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) watch(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	var body struct {
		Watching bool `json:"watching"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	if err := h.svc.SetWatching(r.Context(), actor, chi.URLParam(r, "issueId"), body.Watching); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

// ── comments, attachments, worklogs ────────────────────────────────────

func (h *Handler) addComment(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	var body struct {
		Body string `json:"body"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	comment, err := h.svc.AddComment(r.Context(), actor, chi.URLParam(r, "issueId"), body.Body)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusCreated, comment)
}

func (h *Handler) editComment(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	var body struct {
		Body string `json:"body"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	if err := h.svc.EditComment(r.Context(), actor, chi.URLParam(r, "commentId"), body.Body); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) deleteComment(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	if err := h.svc.DeleteComment(r.Context(), actor, chi.URLParam(r, "commentId")); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) addAttachment(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())

	// The body cap is one byte over the file cap so an oversized upload
	// is rejected by the size check with a readable message rather than
	// by the reader with a truncated stream.
	r.Body = http.MaxBytesReader(w, r.Body, MaxAttachmentBytes+(1<<20))
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		httpkit.ValidationError(w, map[string][]string{"file": {"فایل ارسالی نامعتبر یا بیش از حد بزرگ است"}})
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()

	file, header, err := r.FormFile("file")
	if err != nil {
		httpkit.ValidationError(w, map[string][]string{"file": {"فایلی ارسال نشده است"}})
		return
	}
	defer func() { _ = file.Close() }()

	attachment, err := h.svc.AddAttachment(r.Context(), actor, chi.URLParam(r, "issueId"), UploadInput{
		FileName:  header.Filename,
		MimeType:  header.Header.Get("Content-Type"),
		Size:      header.Size,
		Body:      file,
		CommentID: r.FormValue("commentId"),
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusCreated, attachment)
}

func (h *Handler) downloadAttachment(w http.ResponseWriter, r *http.Request) {
	body, fileName, mimeType, size, err := h.svc.OpenAttachment(r.Context(), chi.URLParam(r, "attachmentId"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	defer func() { _ = body.Close() }()

	w.Header().Set("Content-Type", mimeType)
	if size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}
	// inline, so an image or a PDF opens in the tab instead of landing
	// in the downloads folder. The filename is quoted and RFC 5987
	// encoded because Persian file names are not Latin-1.
	w.Header().Set("Content-Disposition", "inline; filename*=UTF-8''"+urlEscape(fileName))
	// Attachments live behind auth and must not sit in a shared cache.
	w.Header().Set("Cache-Control", "private, max-age=300")

	if _, err := io.Copy(w, body); err != nil {
		h.log.WarnContext(r.Context(), "pm: attachment stream interrupted", slog.String("error", err.Error()))
	}
}

func (h *Handler) deleteAttachment(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	if err := h.svc.DeleteAttachment(r.Context(), actor, chi.URLParam(r, "attachmentId")); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) logWork(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	var body struct {
		Seconds   int     `json:"seconds"`
		Note      string  `json:"note"`
		StartedAt *string `json:"startedAt"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}

	worklog, err := h.svc.LogWork(r.Context(), actor, chi.URLParam(r, "issueId"),
		body.Seconds, body.Note, parseTimePtr(body.StartedAt))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusCreated, worklog)
}

func (h *Handler) deleteWorklog(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	if err := h.svc.DeleteWorklog(r.Context(), actor, chi.URLParam(r, "worklogId")); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) timesheet(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())

	to := time.Now()
	from := to.AddDate(0, 0, -7)
	if v := parseTimePtr(httpkit.QueryStringPtr(r, "from")); v != nil {
		from = *v
	}
	if v := parseTimePtr(httpkit.QueryStringPtr(r, "to")); v != nil {
		to = *v
	}

	logs, total, err := h.svc.Timesheet(r.Context(), actor, from, to)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"items": logs, "totalSeconds": total})
}

// ── notifications ──────────────────────────────────────────────────────

func (h *Handler) notifications(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	limit := int32(50)
	if n, err := strconv.Atoi(httpkit.QueryString(r, "limit")); err == nil && n > 0 {
		limit = int32(n)
	}

	items, unread, err := h.svc.Notifications(r.Context(), actor,
		httpkit.QueryString(r, "unread") == "true", limit)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"items": items, "unread": unread})
}

func (h *Handler) markRead(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	if err := h.svc.MarkRead(r.Context(), actor, body.IDs); err != nil {
		h.fail(w, r, err)
		return
	}
	httpkit.NoContent(w)
}

// notificationStream pushes the unread count over SSE.
//
// SSE rather than WebSocket for the same reason 04-architecture.md gives
// for job status: this is one-way, it is a number, and SSE reconnects on
// its own. The stream carries the count and not the notifications
// themselves — the bell only needs to know that something arrived, and
// the list is one cheap request away when it is opened.
func (h *Handler) notificationStream(w http.ResponseWriter, r *http.Request) {
	actor, _ := MemberFromContext(r.Context())

	// NewResponseController rather than a w.(http.Flusher) assertion:
	// every middleware in the chain wraps the writer, and an assertion
	// only sees the outermost one. The controller walks the Unwrap chain
	// to the writer that can actually flush.
	controller := http.NewResponseController(w)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// Without this, a reverse proxy that buffers will hold every event
	// until the connection closes, which is the same as no stream.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	var last int64 = -1
	send := func() bool {
		count, err := h.svc.UnreadCount(r.Context(), actor)
		if err != nil {
			return false
		}
		// Only changes are sent, plus a comment line as a heartbeat, so
		// an idle tab costs two bytes a tick instead of a JSON payload.
		if count == last {
			_, _ = io.WriteString(w, ": keepalive\n\n")
		} else {
			last = count
			_, _ = io.WriteString(w, "event: unread\ndata: {\"unread\":"+strconv.FormatInt(count, 10)+"}\n\n")
		}
		// A flush that fails means the client is gone or the writer
		// cannot stream; either way there is nothing left to send.
		return controller.Flush() == nil
	}

	if !send() {
		return
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			if !send() {
				return
			}
		}
	}
}

// ── request helpers ────────────────────────────────────────────────────

func filterFromRequest(r *http.Request) IssueFilter {
	f := IssueFilter{
		Query:      httpkit.QueryString(r, "q"),
		StatusIDs:  splitCSV(httpkit.QueryString(r, "status")),
		Categories: splitCSV(httpkit.QueryString(r, "category")),
		Types:      splitCSV(httpkit.QueryString(r, "type")),
		Priorities: splitCSV(httpkit.QueryString(r, "priority")),
		AssigneeID: splitCSV(httpkit.QueryString(r, "assignee")),
		LabelIDs:   splitCSV(httpkit.QueryString(r, "label")),
		ReporterID: httpkit.QueryString(r, "reporter"),
		SprintID:   httpkit.QueryString(r, "sprintId"),
		EpicID:     httpkit.QueryString(r, "epic"),
		ParentID:   httpkit.QueryString(r, "parent"),
		Sort:       httpkit.QueryString(r, "sort"),
	}

	// "me" saves the client from having to substitute its own id into
	// every saved filter, and makes a shared filter URL mean "mine" for
	// whoever opens it.
	if member, ok := MemberFromContext(r.Context()); ok {
		for i, id := range f.AssigneeID {
			if id == "me" {
				f.AssigneeID[i] = member.ID
			}
		}
		if f.ReporterID == "me" {
			f.ReporterID = member.ID
		}
	}

	if httpkit.QueryString(r, "unassigned") == "true" {
		f.NoAssignee = true
	}
	if v := parseTimePtr(httpkit.QueryStringPtr(r, "dueBefore")); v != nil {
		f.DueBefore = v
	}
	return f
}

func splitCSV(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// parseTimePtr accepts RFC 3339 and a bare date. The bare date is what
// a date input sends, and rejecting it would mean every client has to
// remember to append a time.
func parseTimePtr(raw *string) *time.Time {
	if raw == nil || *raw == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if t, err := time.Parse(layout, *raw); err == nil {
			return &t
		}
	}
	return nil
}

func clientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		if first, _, found := strings.Cut(forwarded, ","); found {
			return strings.TrimSpace(first)
		}
		return strings.TrimSpace(forwarded)
	}
	return r.RemoteAddr
}

// urlEscape percent-encodes a filename for Content-Disposition. Using
// url.PathEscape directly would leave "+" and a few other characters
// that some clients turn back into spaces.
func urlEscape(name string) string {
	var b strings.Builder
	for _, c := range []byte(name) {
		switch {
		case (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '.' || c == '_' || c == '~':
			b.WriteByte(c)
		default:
			b.WriteString("%")
			const hex = "0123456789ABCDEF"
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&0x0f])
		}
	}
	return b.String()
}
