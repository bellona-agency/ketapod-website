package integrationtest

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"ketapod/internal/platform/mailer"
	"ketapod/internal/pm"
)

func newPMService(t *testing.T) (*pm.Service, *pgxpool.Pool) {
	t.Helper()
	pool := newPool(t)
	svc := pm.NewService(pm.NewRepository(pool), nil, mailer.NewLogSender(discardLogger()), pm.Config{
		JWTSecret:       "test-secret",
		AccessTokenTTL:  time.Hour,
		RefreshTokenTTL: 24 * time.Hour,
		InviteTTL:       48 * time.Hour,
		AppBaseURL:      "http://pm.test",
	}, discardLogger())
	return svc, pool
}

// pmTeam is the smallest useful setup: an owner and one teammate, which
// is what every test below needs before it can do anything.
func pmTeam(t *testing.T, svc *pm.Service) (owner, mate pm.Member) {
	t.Helper()
	ctx := context.Background()

	tokens, err := svc.Bootstrap(ctx, "sina@ketapod.ir", "سینا راضی", "hamechiz-khoobe", "test", "127.0.0.1")
	require.NoError(t, err)
	owner = tokens.Member

	invite, err := svc.Invite(ctx, owner, "iman@ketapod.ir", "ایمان نیک‌نام", pm.RoleMember)
	require.NoError(t, err)

	token := invite.Link[len("http://pm.test/invite/"):]
	joined, err := svc.AcceptInvite(ctx, token, "ایمان نیک‌نام", "ye-ramz-e-khoob", "test", "127.0.0.1")
	require.NoError(t, err)

	return owner, joined.Member
}

// Bootstrap is the one endpoint that creates an account without an
// invite. If it stays open after the first member, the tool has an
// unauthenticated sign-up form on a public subdomain.
func TestPMBootstrapClosesAfterTheFirstMember(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()

	needs, err := svc.NeedsBootstrap(ctx)
	require.NoError(t, err)
	require.True(t, needs)

	first, err := svc.Bootstrap(ctx, "sina@ketapod.ir", "سینا", "hamechiz-khoobe", "test", "")
	require.NoError(t, err)
	require.Equal(t, pm.RoleOwner, first.Member.Role)
	require.Equal(t, pm.StatusActive, first.Member.Status)

	_, err = svc.Bootstrap(ctx, "someone@else.ir", "غریبه", "password-here", "test", "")
	require.ErrorIs(t, err, pm.ErrForbidden)

	needs, err = svc.NeedsBootstrap(ctx)
	require.NoError(t, err)
	require.False(t, needs)
}

func TestPMLoginRejectsWrongPasswordAndDisabledAccounts(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, mate := pmTeam(t, svc)

	_, err := svc.Login(ctx, "iman@ketapod.ir", "ye-ramz-e-khoob", "test", "")
	require.NoError(t, err)

	_, err = svc.Login(ctx, "iman@ketapod.ir", "ramz-e-eshtebah", "test", "")
	require.ErrorIs(t, err, pm.ErrBadPassword)

	// An unknown address must fail the same way a wrong password does,
	// or the login form tells an attacker which addresses have accounts.
	_, err = svc.Login(ctx, "nobody@ketapod.ir", "ye-ramz-e-khoob", "test", "")
	require.ErrorIs(t, err, pm.ErrBadPassword)

	_, err = svc.UpdateMemberAccess(ctx, owner, mate.ID, pm.RoleMember, pm.StatusDisabled)
	require.NoError(t, err)

	_, err = svc.Login(ctx, "iman@ketapod.ir", "ye-ramz-e-khoob", "test", "")
	require.ErrorIs(t, err, pm.ErrBadPassword)
}

// A refresh token that still works after being spent is a refresh token
// that survives being stolen.
func TestPMRefreshTokenIsSingleUse(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	pmTeam(t, svc)

	first, err := svc.Login(ctx, "iman@ketapod.ir", "ye-ramz-e-khoob", "test", "")
	require.NoError(t, err)

	second, err := svc.Refresh(ctx, first.RefreshToken)
	require.NoError(t, err)
	require.NotEqual(t, first.RefreshToken, second.RefreshToken)

	_, err = svc.Refresh(ctx, first.RefreshToken)
	require.ErrorIs(t, err, pm.ErrUnauthorized)
}

// The last owner must not be able to lock everyone out: an instance
// with no owner can never invite again, and the only repair is a
// hand-written UPDATE against production.
func TestPMLastOwnerCannotBeDemoted(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, mate := pmTeam(t, svc)

	_, err := svc.UpdateMemberAccess(ctx, owner, owner.ID, pm.RoleAdmin, pm.StatusActive)
	require.ErrorIs(t, err, pm.ErrValidation)

	_, err = svc.UpdateMemberAccess(ctx, owner, mate.ID, pm.RoleOwner, pm.StatusActive)
	require.NoError(t, err)

	// With a second owner in place the first one may step down.
	_, err = svc.UpdateMemberAccess(ctx, owner, owner.ID, pm.RoleAdmin, pm.StatusActive)
	require.NoError(t, err)
}

func newPMProject(t *testing.T, svc *pm.Service, owner pm.Member) pm.Project {
	t.Helper()
	project, err := svc.CreateProject(context.Background(), owner, pm.NewProject{
		Key: "KET", Name: "کتاپاد", Description: "کارهای پلتفرم",
	})
	require.NoError(t, err)
	return project
}

func TestPMProjectStartsWithAUsableBoard(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, _ := pmTeam(t, svc)

	project := newPMProject(t, svc, owner)
	require.Equal(t, "KET", project.Key)

	statuses, err := svc.Statuses(ctx, project.ID)
	require.NoError(t, err)
	require.Len(t, statuses, 4)
	require.Equal(t, pm.CategoryTodo, statuses[0].Category)
	require.Equal(t, pm.CategoryDone, statuses[3].Category)

	// A project key is unique regardless of case: "ket" and "KET" would
	// otherwise be two projects whose issues look identical in chat.
	_, err = svc.CreateProject(ctx, owner, pm.NewProject{Key: "ket", Name: "دیگری"})
	require.ErrorIs(t, err, pm.ErrConflict)
}

func TestPMIssueNumbersAreSequentialPerProject(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, _ := pmTeam(t, svc)

	newPMProject(t, svc, owner)
	_, err := svc.CreateProject(ctx, owner, pm.NewProject{Key: "WEB", Name: "وب‌سایت"})
	require.NoError(t, err)

	first, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{ProjectKey: "KET", Title: "اولین کار"})
	require.NoError(t, err)
	require.Equal(t, "KET-1", first.Key)

	second, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{ProjectKey: "KET", Title: "دومین کار"})
	require.NoError(t, err)
	require.Equal(t, "KET-2", second.Key)

	// The counter is per project, not global.
	other, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{ProjectKey: "WEB", Title: "کار وب"})
	require.NoError(t, err)
	require.Equal(t, "WEB-1", other.Key)
}

// Creating an issue must write its starting status into the history,
// because every report reconstructs "what was this on that day" from
// exactly those rows.
func TestPMIssueCreationRecordsItsStartingStatus(t *testing.T) {
	svc, pool := newPMService(t)
	ctx := context.Background()
	owner, _ := pmTeam(t, svc)
	newPMProject(t, svc, owner)

	issue, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{ProjectKey: "KET", Title: "کار"})
	require.NoError(t, err)

	var count int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM pm.activity WHERE issue_id = $1 AND field = 'status'`, issue.ID).Scan(&count))
	require.Equal(t, 1, count)
}

func TestPMBoardGroupsIssuesIntoColumns(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, mate := pmTeam(t, svc)
	project := newPMProject(t, svc, owner)

	statuses, err := svc.Statuses(ctx, project.ID)
	require.NoError(t, err)

	todo, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{
		ProjectKey: "KET", Title: "طراحی صفحه", AssigneeID: mate.ID,
	})
	require.NoError(t, err)
	_, err = svc.CreateIssue(ctx, owner, pm.NewIssueInput{ProjectKey: "KET", Title: "کار دوم"})
	require.NoError(t, err)

	inProgress := statuses[1].ID
	_, err = svc.MoveIssue(ctx, owner, todo.ID, inProgress, "", "", "", false)
	require.NoError(t, err)

	board, err := svc.Board(ctx, "KET", "backlog", pm.IssueFilter{})
	require.NoError(t, err)
	require.Len(t, board.Columns, 4)
	require.Len(t, board.Columns[0].Issues, 1)
	require.Len(t, board.Columns[1].Issues, 1)
	require.Equal(t, "KET-1", board.Columns[1].Issues[0].Key)
	require.Equal(t, mate.ID, board.Columns[1].Issues[0].Assignee.ID)
}

// Dragging within a column must not renumber the column. Two moves in a
// row into the same gap is where a naive ordering scheme starts
// producing duplicate positions and the board flickers.
func TestPMDragOrdersCardsWithoutRewritingTheColumn(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, _ := pmTeam(t, svc)
	newPMProject(t, svc, owner)

	var ids []string
	for _, title := range []string{"یک", "دو", "سه", "چهار"} {
		issue, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{ProjectKey: "KET", Title: title})
		require.NoError(t, err)
		ids = append(ids, issue.ID)
	}

	// Move the last card to the very top, then between the first two.
	_, err := svc.MoveIssue(ctx, owner, ids[3], "", "", ids[0], "", false)
	require.NoError(t, err)
	_, err = svc.MoveIssue(ctx, owner, ids[2], "", ids[3], ids[0], "", false)
	require.NoError(t, err)

	board, err := svc.Board(ctx, "KET", "backlog", pm.IssueFilter{})
	require.NoError(t, err)

	order := make([]string, 0, 4)
	for _, issue := range board.Columns[0].Issues {
		order = append(order, issue.Title)
	}
	require.Equal(t, []string{"چهار", "سه", "یک", "دو"}, order)
}

// resolved_at is derived from the status category, never sent by a
// client. Cycle-time reporting reads it, so a client that could write it
// could lie about delivery dates.
func TestPMResolvedAtFollowsTheDoneColumn(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, _ := pmTeam(t, svc)
	project := newPMProject(t, svc, owner)

	statuses, err := svc.Statuses(ctx, project.ID)
	require.NoError(t, err)
	done, todo := statuses[3].ID, statuses[0].ID

	issue, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{ProjectKey: "KET", Title: "کار"})
	require.NoError(t, err)
	require.Nil(t, issue.ResolvedAt)

	moved, err := svc.MoveIssue(ctx, owner, issue.ID, done, "", "", "", false)
	require.NoError(t, err)
	require.NotNil(t, moved.ResolvedAt)

	reopened, err := svc.MoveIssue(ctx, owner, issue.ID, todo, "", "", "", false)
	require.NoError(t, err)
	require.Nil(t, reopened.ResolvedAt)
}

func TestPMPersianSearchFindsIssuesAcrossSpellings(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, _ := pmTeam(t, svc)
	project := newPMProject(t, svc, owner)

	_, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{
		ProjectKey: "KET", Title: "قصه‌های کودکانه را به کاتالوگ اضافه کن",
	})
	require.NoError(t, err)
	_, err = svc.CreateIssue(ctx, owner, pm.NewIssueInput{ProjectKey: "KET", Title: "رفع باگ پرداخت"})
	require.NoError(t, err)

	// Written with a space instead of the zero-width non-joiner, which
	// is a different byte sequence and the reason the fold has to be in
	// the index as well as the query.
	found, _, err := svc.SearchIssues(ctx, pm.IssueFilter{ProjectID: project.ID, Query: "قصه های"})
	require.NoError(t, err)
	require.Len(t, found, 1)
	require.Contains(t, found[0].Title, "قصه‌های")

	// The key people paste from chat has to work in the same box.
	byKey, _, err := svc.SearchIssues(ctx, pm.IssueFilter{Query: "ket-2"})
	require.NoError(t, err)
	require.Len(t, byKey, 1)
	require.Equal(t, "KET-2", byKey[0].Key)
}

// Completing a sprint moves unfinished work out of it. Velocity must
// still see that work as having been committed, or every sprint looks
// like a success.
func TestPMCompletingASprintCarriesWorkOverAndKeepsVelocityHonest(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, _ := pmTeam(t, svc)
	project := newPMProject(t, svc, owner)

	statuses, err := svc.Statuses(ctx, project.ID)
	require.NoError(t, err)
	done := statuses[3].ID

	start := time.Now().Add(-10 * 24 * time.Hour)
	end := time.Now().Add(-2 * 24 * time.Hour)
	sprint, err := svc.CreateSprint(ctx, owner, project.ID, "اسپرینت ۱", "اولین تحویل", &start, &end)
	require.NoError(t, err)

	next, err := svc.CreateSprint(ctx, owner, project.ID, "اسپرینت ۲", "", nil, nil)
	require.NoError(t, err)

	three, five := 3.0, 5.0
	finished, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{
		ProjectKey: "KET", Title: "تمام شد", SprintID: sprint.ID, StoryPoints: &three,
	})
	require.NoError(t, err)
	_, err = svc.CreateIssue(ctx, owner, pm.NewIssueInput{
		ProjectKey: "KET", Title: "تمام نشد", SprintID: sprint.ID, StoryPoints: &five,
	})
	require.NoError(t, err)

	started, err := svc.StartSprint(ctx, owner, sprint.ID)
	require.NoError(t, err)
	require.Equal(t, pm.SprintActive, started.State)
	require.Equal(t, 8.0, started.Points)

	_, err = svc.MoveIssue(ctx, owner, finished.ID, done, "", "", "", false)
	require.NoError(t, err)

	result, err := svc.CompleteSprint(ctx, owner, sprint.ID, next.ID)
	require.NoError(t, err)
	require.Equal(t, int64(1), result.CarriedOver)

	// The unfinished issue is now in the next sprint.
	carried, _, err := svc.SearchIssues(ctx, pm.IssueFilter{SprintID: next.ID})
	require.NoError(t, err)
	require.Len(t, carried, 1)
	require.Equal(t, "تمام نشد", carried[0].Title)

	velocity, err := svc.Velocity(ctx, project.ID, 8)
	require.NoError(t, err)
	require.Len(t, velocity, 1)
	require.Equal(t, 8.0, velocity[0].Committed, "carried-over work must still count as committed")
	require.Equal(t, 3.0, velocity[0].Completed)
	require.Equal(t, int64(1), velocity[0].CarriedOverAt)
}

// Only one sprint per project may run at a time, and the rule has to be
// in the database: two people pressing Start in the same second both
// pass a check written in Go.
func TestPMOnlyOneSprintCanBeActive(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, _ := pmTeam(t, svc)
	project := newPMProject(t, svc, owner)

	first, err := svc.CreateSprint(ctx, owner, project.ID, "اسپرینت ۱", "", nil, nil)
	require.NoError(t, err)
	second, err := svc.CreateSprint(ctx, owner, project.ID, "اسپرینت ۲", "", nil, nil)
	require.NoError(t, err)

	for _, sprintID := range []string{first.ID, second.ID} {
		_, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{
			ProjectKey: "KET", Title: "کاری", SprintID: sprintID,
		})
		require.NoError(t, err)
	}

	_, err = svc.StartSprint(ctx, owner, first.ID)
	require.NoError(t, err)

	_, err = svc.StartSprint(ctx, owner, second.ID)
	require.ErrorIs(t, err, pm.ErrValidation)

	// An empty sprint has no burndown and a velocity of zero; starting
	// one is almost always a misclick.
	third, err := svc.CreateSprint(ctx, owner, project.ID, "خالی", "", nil, nil)
	require.NoError(t, err)
	_, err = svc.StartSprint(ctx, owner, third.ID)
	require.ErrorIs(t, err, pm.ErrValidation)
}

func TestPMBurndownReconstructsRemainingWorkPerDay(t *testing.T) {
	svc, pool := newPMService(t)
	ctx := context.Background()
	owner, _ := pmTeam(t, svc)
	project := newPMProject(t, svc, owner)

	statuses, err := svc.Statuses(ctx, project.ID)
	require.NoError(t, err)
	done := statuses[3].ID

	start := time.Now().Add(-4 * 24 * time.Hour)
	end := time.Now().Add(24 * time.Hour)
	sprint, err := svc.CreateSprint(ctx, owner, project.ID, "اسپرینت", "", &start, &end)
	require.NoError(t, err)

	points := 4.0
	var ids []string
	for _, title := range []string{"کار الف", "کار ب", "کار ج"} {
		issue, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{
			ProjectKey: "KET", Title: title, SprintID: sprint.ID, StoryPoints: &points,
		})
		require.NoError(t, err)
		ids = append(ids, issue.ID)
	}

	// Backdate creation and the sprint start, so the chart has days to
	// draw rather than a single point at "now".
	_, err = pool.Exec(ctx, `UPDATE pm.issues SET created_at = $1 WHERE sprint_id = $2`, start, sprint.ID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE pm.activity SET created_at = $1 WHERE issue_id = ANY($2)`, start, ids)
	require.NoError(t, err)
	_, err = pool.Exec(ctx,
		`UPDATE pm.sprints SET state = 'active', started_at = $1 WHERE id = $2`, start, sprint.ID)
	require.NoError(t, err)

	// One finished two days in.
	_, err = svc.MoveIssue(ctx, owner, ids[0], done, "", "", "", false)
	require.NoError(t, err)
	_, err = pool.Exec(ctx,
		`UPDATE pm.activity SET created_at = $1
		 WHERE issue_id = $2 AND field = 'status' AND new_value = $3`,
		start.Add(48*time.Hour), ids[0], done)
	require.NoError(t, err)

	report, err := svc.Burndown(ctx, sprint.ID)
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(report.Points), 4)

	first := report.Points[0]
	last := report.Points[len(report.Points)-1]

	require.Equal(t, 12.0, first.Scope)
	require.Equal(t, 12.0, first.Remaining, "nothing is done on day one")
	require.Equal(t, 8.0, last.Remaining, "one four-point issue was finished")
	require.Equal(t, 12.0, first.Ideal)
	require.InDelta(t, 0.0, last.Ideal, 0.001)
}

// A comment must notify the people watching and the people mentioned,
// and never both about the same comment — two pings for one comment is
// how people learn to ignore the bell.
func TestPMCommentNotifiesMentionsAndWatchersExactlyOnce(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, mate := pmTeam(t, svc)
	newPMProject(t, svc, owner)

	issue, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{
		ProjectKey: "KET", Title: "کار مشترک", AssigneeID: mate.ID,
	})
	require.NoError(t, err)

	// The assignee already has an "assigned" notification; clear it so
	// the comment's effect is what is being measured.
	require.NoError(t, svc.MarkRead(ctx, mate, nil))

	_, err = svc.AddComment(ctx, owner, issue.ID, "@["+mate.FullName+"]("+mate.ID+") این را نگاه کن")
	require.NoError(t, err)

	items, unread, err := svc.Notifications(ctx, mate, true, 50)
	require.NoError(t, err)
	require.Equal(t, int64(1), unread, "mentioned watcher must be notified once, not twice")
	require.Equal(t, pm.NotifyMentioned, items[0].Kind)

	// The author of the comment is never notified about their own words.
	_, ownerUnread, err := svc.Notifications(ctx, owner, true, 50)
	require.NoError(t, err)
	require.Equal(t, int64(0), ownerUnread)
}

// A viewer reads the board and nothing else. The check has to hold at
// the service layer, not only in the router, because the router is one
// forgotten middleware away from being wrong.
func TestPMViewerCannotWrite(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, mate := pmTeam(t, svc)
	newPMProject(t, svc, owner)

	viewer, err := svc.UpdateMemberAccess(ctx, owner, mate.ID, pm.RoleViewer, pm.StatusActive)
	require.NoError(t, err)

	_, err = svc.CreateIssue(ctx, viewer, pm.NewIssueInput{ProjectKey: "KET", Title: "نباید ساخته شود"})
	require.ErrorIs(t, err, pm.ErrForbidden)

	issue, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{ProjectKey: "KET", Title: "کار"})
	require.NoError(t, err)

	_, err = svc.UpdateIssue(ctx, viewer, issue.ID, pm.IssuePatchInput{Title: strPtr("عوض شد")})
	require.ErrorIs(t, err, pm.ErrForbidden)
}

// A parent cycle makes the subtask tree infinite and the issue page
// never finishes rendering.
func TestPMParentCycleIsRefused(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, _ := pmTeam(t, svc)
	newPMProject(t, svc, owner)

	parent, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{ProjectKey: "KET", Title: "والد"})
	require.NoError(t, err)
	child, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{
		ProjectKey: "KET", Title: "فرزند", ParentID: parent.ID, Type: pm.TypeSubtask,
	})
	require.NoError(t, err)

	_, err = svc.UpdateIssue(ctx, owner, parent.ID, pm.IssuePatchInput{ParentID: &child.ID})
	require.ErrorIs(t, err, pm.ErrValidation)

	_, err = svc.UpdateIssue(ctx, owner, parent.ID, pm.IssuePatchInput{ParentID: &parent.ID})
	require.ErrorIs(t, err, pm.ErrValidation)
}

// Deleting a board column must not leave its issues without one. The
// foreign key refuses the delete on purpose; the service has to move
// the work first, in the same transaction.
func TestPMDeletingAColumnMovesItsIssues(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, _ := pmTeam(t, svc)
	project := newPMProject(t, svc, owner)

	statuses, err := svc.Statuses(ctx, project.ID)
	require.NoError(t, err)
	review, todo := statuses[2], statuses[0]

	issue, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{
		ProjectKey: "KET", Title: "در بازبینی", StatusID: review.ID,
	})
	require.NoError(t, err)

	// Without a destination the delete must fail rather than orphan it.
	require.Error(t, svc.DeleteStatus(ctx, owner, review.ID, ""))

	require.NoError(t, svc.DeleteStatus(ctx, owner, review.ID, todo.ID))

	moved, _, err := svc.SearchIssues(ctx, pm.IssueFilter{ProjectID: project.ID})
	require.NoError(t, err)
	require.Len(t, moved, 1)
	require.Equal(t, todo.ID, moved[0].Status.ID)
	require.Equal(t, issue.ID, moved[0].ID)
}

func TestPMWorklogsFeedTheIssueAndTheTimesheet(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, _ := pmTeam(t, svc)
	newPMProject(t, svc, owner)

	issue, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{ProjectKey: "KET", Title: "کار"})
	require.NoError(t, err)

	yesterday := time.Now().Add(-24 * time.Hour)
	_, err = svc.LogWork(ctx, owner, issue.ID, 3600, "پیاده‌سازی", &yesterday)
	require.NoError(t, err)
	_, err = svc.LogWork(ctx, owner, issue.ID, 1800, "تست", nil)
	require.NoError(t, err)

	// Over a day is almost always minutes typed into a seconds field.
	_, err = svc.LogWork(ctx, owner, issue.ID, 90000, "", nil)
	require.ErrorIs(t, err, pm.ErrValidation)

	detail, err := svc.Issue(ctx, "KET", 1)
	require.NoError(t, err)
	require.Equal(t, 5400, detail.SpentSec)
	require.Len(t, detail.Worklogs, 2)

	logs, total, err := svc.Timesheet(ctx, owner, time.Now().Add(-48*time.Hour), time.Now().Add(time.Hour))
	require.NoError(t, err)
	require.Len(t, logs, 2)
	require.Equal(t, int64(5400), total)
	require.Equal(t, "KET-1", logs[0].IssueKey)
}

func strPtr(s string) *string { return &s }

// Being handed work on a project is the definition of being on it. The
// bug this guards against: the assignee dropdown offers the whole team
// when a project has no members yet, so anyone can be assigned — and
// then the person assigned cannot comment on their own issue.
func TestPMAssigningSomeoneAddsThemToTheProject(t *testing.T) {
	svc, _ := newPMService(t)
	ctx := context.Background()
	owner, mate := pmTeam(t, svc)
	project := newPMProject(t, svc, owner)

	issue, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{
		ProjectKey: "KET", Title: "کاری برای ایمان", AssigneeID: mate.ID,
	})
	require.NoError(t, err)

	// The assignee can now act on their own issue.
	_, err = svc.AddComment(ctx, mate, issue.ID, "شروع کردم")
	require.NoError(t, err)

	members, err := svc.ProjectMembers(ctx, project.ID)
	require.NoError(t, err)
	require.Condition(t, func() bool {
		for _, entry := range members {
			if entry.Member.ID == mate.ID {
				return true
			}
		}
		return false
	}, "assignee must be on the project")

	// Reassigning through a patch has to do the same thing.
	other, err := svc.CreateIssue(ctx, owner, pm.NewIssueInput{ProjectKey: "KET", Title: "کار دوم"})
	require.NoError(t, err)
	_, err = svc.UpdateIssue(ctx, owner, other.ID, pm.IssuePatchInput{AssigneeID: &mate.ID})
	require.NoError(t, err)
	_, err = svc.AddComment(ctx, mate, other.ID, "این هم دیدم")
	require.NoError(t, err)
}
