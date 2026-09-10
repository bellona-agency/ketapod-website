package pm

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

// MaxAttachmentBytes bounds a single upload. Twenty megabytes takes a
// screenshot, a log file and a PDF spec, and stops someone from parking
// a video in the issue tracker.
const MaxAttachmentBytes = 20 << 20

// attachmentPrefix keeps pm's objects in their own corner of the bucket
// the rest of the project already uses. One bucket, separate prefixes:
// a second bucket would be a second thing to create, back up and get
// wrong on a new environment.
const attachmentPrefix = "pm/attachments/"

// ── comments ───────────────────────────────────────────────────────────

func (s *Service) AddComment(ctx context.Context, actor Member, issueID, body string) (Comment, error) {
	issue, err := s.repo.IssueByID(ctx, issueID)
	if err != nil {
		return Comment{}, err
	}
	if err := s.requireProjectWrite(ctx, actor, issue.ProjectID); err != nil {
		return Comment{}, err
	}
	if strings.TrimSpace(body) == "" {
		return Comment{}, fmt.Errorf("%w: متن کامنت خالی است", ErrValidation)
	}

	comment, err := s.repo.CreateComment(ctx, issueID, actor.ID, body)
	if err != nil {
		return Comment{}, err
	}

	// Commenting is how you say "I am involved", so it subscribes you.
	// Otherwise the reply to your own question never reaches you.
	if err := s.repo.SetWatching(ctx, issueID, actor.ID, true); err != nil {
		return Comment{}, err
	}

	s.notifyComment(ctx, actor, issue, body)
	return comment, nil
}

func (s *Service) EditComment(ctx context.Context, actor Member, commentID, body string) error {
	if strings.TrimSpace(body) == "" {
		return fmt.Errorf("%w: متن کامنت خالی است", ErrValidation)
	}
	// Editing is restricted to the author even for admins. An admin who
	// can rewrite what someone else said is a tool nobody speaks freely
	// in; an admin who can delete it is a tool that can be moderated.
	return s.repo.UpdateComment(ctx, commentID, actor.ID, body)
}

func (s *Service) DeleteComment(ctx context.Context, actor Member, commentID string) error {
	return s.repo.DeleteComment(ctx, commentID, actor.ID, actor.CanAdmin())
}

// ── attachments ────────────────────────────────────────────────────────

type UploadInput struct {
	FileName  string
	MimeType  string
	Size      int64
	Body      io.Reader
	CommentID string
}

func (s *Service) AddAttachment(ctx context.Context, actor Member, issueID string, in UploadInput) (Attachment, error) {
	issue, err := s.repo.IssueByID(ctx, issueID)
	if err != nil {
		return Attachment{}, err
	}
	if err := s.requireProjectWrite(ctx, actor, issue.ProjectID); err != nil {
		return Attachment{}, err
	}
	if in.Size <= 0 || in.Size > MaxAttachmentBytes {
		return Attachment{}, fmt.Errorf("%w: حجم فایل باید بین ۱ بایت و ۲۰ مگابایت باشد", ErrValidation)
	}

	// The stored key is a fresh uuid plus the extension, never the
	// uploaded name. A name from a browser can contain slashes, "..",
	// and characters the object store treats specially; the real name
	// travels in the database column, where it is only ever data.
	ext := strings.ToLower(filepath.Ext(in.FileName))
	if len(ext) > 10 {
		ext = ""
	}
	key := attachmentPrefix + issue.ProjectID + "/" + uuid.NewString() + ext

	mimeType := in.MimeType
	if mimeType == "" {
		mimeType = mime.TypeByExtension(ext)
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	if err := s.store.PutObject(ctx, key, in.Body, mimeType); err != nil {
		return Attachment{}, fmt.Errorf("pm: store attachment: %w", err)
	}

	attachment, err := s.repo.CreateAttachment(ctx, issueID, in.CommentID,
		filepath.Base(in.FileName), key, mimeType, in.Size, actor.ID)
	if err != nil {
		// The object is already written; leaving it is the lesser evil
		// against failing the request twice, and an orphan with no row
		// is invisible rather than wrong.
		s.log.WarnContext(ctx, "pm: attachment row failed after upload",
			slog.String("key", key), slog.String("error", err.Error()))
		return Attachment{}, err
	}

	attachment.URL = "/api/v1/attachments/" + attachment.ID
	return attachment, nil
}

// OpenAttachment streams the bytes back through this service rather than
// handing out an object-store URL. The bucket is not public, the tool is
// not public, and a signed URL would be a link that keeps working after
// the person who got it leaves the team.
func (s *Service) OpenAttachment(ctx context.Context, id string) (io.ReadCloser, string, string, int64, error) {
	key, fileName, mimeType, err := s.repo.AttachmentStorageKey(ctx, id)
	if err != nil {
		return nil, "", "", 0, err
	}

	object, err := s.store.GetObject(ctx, key, "")
	if err != nil {
		return nil, "", "", 0, fmt.Errorf("pm: read attachment: %w", err)
	}
	return object.Body, fileName, mimeType, object.ContentLength, nil
}

func (s *Service) DeleteAttachment(ctx context.Context, actor Member, id string) error {
	if !actor.CanWrite() {
		return ErrForbidden
	}
	// The row goes first. An object with no row is invisible; a row with
	// no object is a download that fails, which is the worse of the two.
	if _, err := s.repo.DeleteAttachment(ctx, id); err != nil {
		return err
	}
	return nil
}

// ── worklogs ───────────────────────────────────────────────────────────

func (s *Service) LogWork(ctx context.Context, actor Member, issueID string, seconds int, note string, startedAt *time.Time) (Worklog, error) {
	issue, err := s.repo.IssueByID(ctx, issueID)
	if err != nil {
		return Worklog{}, err
	}
	if err := s.requireProjectWrite(ctx, actor, issue.ProjectID); err != nil {
		return Worklog{}, err
	}
	if seconds <= 0 {
		return Worklog{}, fmt.Errorf("%w: مدت زمان باید بیشتر از صفر باشد", ErrValidation)
	}
	// A day has 86400 seconds and nobody works one on a single issue.
	// The cap catches the far more common case: minutes typed into a
	// field that wanted seconds.
	if seconds > 86400 {
		return Worklog{}, fmt.Errorf("%w: مدت زمان هر ثبت حداکثر ۲۴ ساعت است", ErrValidation)
	}

	when := time.Now()
	if startedAt != nil {
		when = *startedAt
	}
	return s.repo.CreateWorklog(ctx, issueID, actor.ID, seconds, strings.TrimSpace(note), when)
}

func (s *Service) DeleteWorklog(ctx context.Context, actor Member, id string) error {
	return s.repo.DeleteWorklog(ctx, id, actor.ID, actor.CanAdmin())
}

func (s *Service) Timesheet(ctx context.Context, actor Member, from, to time.Time) ([]Worklog, int64, error) {
	logs, err := s.repo.MyWorklogs(ctx, actor.ID, from, to)
	if err != nil {
		return nil, 0, err
	}
	if logs == nil {
		logs = []Worklog{}
	}

	var total int64
	for _, l := range logs {
		total += int64(l.Seconds)
	}
	return logs, total, nil
}

// ── notifications ──────────────────────────────────────────────────────

func (s *Service) Notifications(ctx context.Context, actor Member, unreadOnly bool, limit int32) ([]Notification, int64, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	items, unread, err := s.repo.ListNotifications(ctx, actor.ID, unreadOnly, limit)
	if err != nil {
		return nil, 0, err
	}
	if items == nil {
		items = []Notification{}
	}
	return items, unread, nil
}

func (s *Service) MarkRead(ctx context.Context, actor Member, ids []string) error {
	return s.repo.MarkNotificationsRead(ctx, actor.ID, ids)
}

func (s *Service) UnreadCount(ctx context.Context, actor Member) (int64, error) {
	return s.repo.UnreadCount(ctx, actor.ID)
}

// notify writes the fan-out. Notification delivery is never allowed to
// fail the action that caused it: a comment that posts and then 500s
// because the bell could not be updated is a comment the user posts
// again.
func (s *Service) notify(ctx context.Context, items []NewNotification) {
	if err := s.repo.CreateNotifications(ctx, items); err != nil {
		s.log.WarnContext(ctx, "pm: notify failed", slog.String("error", err.Error()))
	}
}

// notifyComment tells the mentioned people first and the watchers
// second, and never both about the same comment. Being mentioned is a
// request for your attention; a comment on something you watch is news.
// Sending two notifications for one comment is how people turn the bell
// off.
func (s *Service) notifyComment(ctx context.Context, actor Member, issue Issue, body string) {
	mentioned := ExtractMentions(body)
	mentionedSet := make(map[string]struct{}, len(mentioned))

	preview := PlainText(body)
	if len([]rune(preview)) > 140 {
		preview = string([]rune(preview)[:140]) + "…"
	}

	items := make([]NewNotification, 0, len(mentioned)+4)
	for _, id := range mentioned {
		mentionedSet[id] = struct{}{}
		items = append(items, NewNotification{
			MemberID: id, Kind: NotifyMentioned, IssueID: issue.ID, ActorID: actor.ID,
			Title: actor.FullName + " شما را در " + issue.Key + " منشن کرد",
			Body:  preview,
		})
	}

	watchers, err := s.repo.WatcherIDs(ctx, issue.ID)
	if err != nil {
		s.log.WarnContext(ctx, "pm: watcher lookup failed", slog.String("error", err.Error()))
	}
	for _, id := range watchers {
		if _, dup := mentionedSet[id]; dup {
			continue
		}
		items = append(items, NewNotification{
			MemberID: id, Kind: NotifyCommented, IssueID: issue.ID, ActorID: actor.ID,
			Title: "کامنت تازه روی " + issue.Key,
			Body:  preview,
		})
	}

	s.notify(ctx, items)
}

// notifyIssueChange turns the diff into notifications. Only two changes
// are worth interrupting someone for: being handed the work, and the
// work being declared done. Notifying on every field change is how a
// tool trains its users to ignore it.
func (s *Service) notifyIssueChange(ctx context.Context, actor Member, issue Issue, entries []ActivityEntry) {
	var items []NewNotification

	for _, e := range entries {
		switch e.Field {
		case "assignee":
			if e.NewValue == "" {
				continue
			}
			items = append(items, NewNotification{
				MemberID: e.NewValue, Kind: NotifyAssigned, IssueID: issue.ID, ActorID: actor.ID,
				Title: issue.Key + " به شما واگذار شد",
				Body:  issue.Title,
			})
		case "status":
			if issue.Status.Category != CategoryDone {
				continue
			}
			watchers, err := s.repo.WatcherIDs(ctx, issue.ID)
			if err != nil {
				s.log.WarnContext(ctx, "pm: watcher lookup failed", slog.String("error", err.Error()))
				continue
			}
			for _, id := range watchers {
				items = append(items, NewNotification{
					MemberID: id, Kind: NotifyStatusChanged, IssueID: issue.ID, ActorID: actor.ID,
					Title: issue.Key + " به «" + issue.Status.Name + "» رفت",
					Body:  issue.Title,
				})
			}
		}
	}

	s.notify(ctx, items)
}
