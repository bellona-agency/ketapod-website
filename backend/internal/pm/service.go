package pm

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"ketapod/internal/platform/mailer"
	"ketapod/internal/platform/storage"
)

var (
	ErrValidation  = errors.New("pm: validation")
	ErrForbidden   = errors.New("pm: forbidden")
	ErrBadPassword = errors.New("pm: bad credentials")
	ErrInviteUsed  = errors.New("pm: invite already used or expired")
)

type Config struct {
	JWTSecret       string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	InviteTTL       time.Duration

	// AppBaseURL is where the tool's frontend lives (pm.ketapod.ir).
	// Invite emails need an absolute URL, and a path-only link in an
	// email goes nowhere.
	AppBaseURL string

	// MailEnabled says whether a real mail host is configured. Without
	// it the LogSender still returns success — it did write the mail,
	// to the log — and the invite dialog would tell an admin the email
	// was sent when nothing left the building. The admin needs to know
	// to paste the link themselves.
	MailEnabled bool
}

type Service struct {
	repo  *Repository
	store *storage.Storage
	mail  mailer.Sender
	cfg   Config
	log   *slog.Logger
}

func NewService(repo *Repository, store *storage.Storage, mail mailer.Sender, cfg Config, log *slog.Logger) *Service {
	return &Service{repo: repo, store: store, mail: mail, cfg: cfg, log: log}
}

// ── authentication ─────────────────────────────────────────────────────

type Tokens struct {
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken"`
	ExpiresAt    time.Time `json:"expiresAt"`
	Member       Member    `json:"member"`
}

// Login verifies the password and starts a session.
//
// The error returned is the same whether the address is unknown, the
// password is wrong or the account is disabled. Distinguishing them is
// friendlier and turns the login form into an oracle for which addresses
// have accounts.
func (s *Service) Login(ctx context.Context, email, password, userAgent, ip string) (Tokens, error) {
	member, hash, err := s.repo.MemberByEmail(ctx, strings.TrimSpace(email))
	if err != nil || hash == "" || member.Status != StatusActive {
		// Still spend the time a real verification would, so the
		// response time does not answer the question the error refuses
		// to. The cost is one argon2 pass on a failed login.
		if hash == "" {
			_, _ = HashPassword(password)
		}
		return Tokens{}, ErrBadPassword
	}

	if err := VerifyPassword(hash, password); err != nil {
		return Tokens{}, ErrBadPassword
	}

	s.repo.PurgeExpiredSessions(ctx)
	return s.startSession(ctx, member, userAgent, ip)
}

func (s *Service) startSession(ctx context.Context, member Member, userAgent, ip string) (Tokens, error) {
	access, expires, err := issueAccessToken(s.cfg.JWTSecret, member.ID, member.Role, s.cfg.AccessTokenTTL)
	if err != nil {
		return Tokens{}, err
	}

	refresh, refreshHash, err := newOpaqueToken()
	if err != nil {
		return Tokens{}, err
	}
	if err := s.repo.CreateSession(ctx, member.ID, refreshHash, userAgent, ip,
		time.Now().Add(s.cfg.RefreshTokenTTL)); err != nil {
		return Tokens{}, err
	}

	s.repo.TouchMember(ctx, member.ID)
	return Tokens{AccessToken: access, RefreshToken: refresh, ExpiresAt: expires, Member: member}, nil
}

// Refresh rotates the refresh token as it is spent. A refresh token that
// is accepted twice is a refresh token that survives being stolen.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (Tokens, error) {
	newToken, newHash, err := newOpaqueToken()
	if err != nil {
		return Tokens{}, err
	}

	memberID, err := s.repo.RotateSession(ctx, hashToken(refreshToken), newHash,
		time.Now().Add(s.cfg.RefreshTokenTTL))
	if err != nil {
		return Tokens{}, ErrUnauthorized
	}

	member, err := s.EnsureActive(ctx, memberID)
	if err != nil {
		return Tokens{}, err
	}

	access, expires, err := issueAccessToken(s.cfg.JWTSecret, member.ID, member.Role, s.cfg.AccessTokenTTL)
	if err != nil {
		return Tokens{}, err
	}
	return Tokens{AccessToken: access, RefreshToken: newToken, ExpiresAt: expires, Member: member}, nil
}

func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	return s.repo.RevokeSession(ctx, hashToken(refreshToken))
}

// EnsureActive is what Authenticator calls behind every request.
func (s *Service) EnsureActive(ctx context.Context, memberID string) (Member, error) {
	member, err := s.repo.MemberByID(ctx, memberID)
	if err != nil {
		return Member{}, err
	}
	if member.Status != StatusActive {
		return Member{}, ErrDisabled
	}
	return member, nil
}

// ── invites ────────────────────────────────────────────────────────────

type InviteResult struct {
	Member Member `json:"member"`
	// Link is returned so an admin can paste it into chat. With SMTP
	// configured the mail is sent too, but the link is not hidden: an
	// invite that only exists inside an email nobody received is the
	// single most common way an internal tool fails on day one.
	Link string `json:"link"`
	Sent bool   `json:"emailSent"`
}

func (s *Service) Invite(ctx context.Context, actor Member, email, fullName, role string) (InviteResult, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if _, err := mail.ParseAddress(email); err != nil {
		return InviteResult{}, fmt.Errorf("%w: ایمیل نامعتبر است", ErrValidation)
	}
	if !validRole(role) {
		return InviteResult{}, fmt.Errorf("%w: نقش نامعتبر است", ErrValidation)
	}
	// Only an owner can mint another owner. Otherwise any admin could
	// promote themselves through the invite form.
	if role == RoleOwner && actor.Role != RoleOwner {
		return InviteResult{}, ErrForbidden
	}

	member, _, err := s.repo.MemberByEmail(ctx, email)
	switch {
	case errors.Is(err, ErrNotFound):
		member, err = s.repo.CreateMember(ctx, email, strings.TrimSpace(fullName), role, avatarColorFor(email))
		if err != nil {
			return InviteResult{}, err
		}
	case err != nil:
		return InviteResult{}, err
	case member.Status == StatusActive:
		return InviteResult{}, fmt.Errorf("%w: این ایمیل قبلاً عضو است", ErrValidation)
	}

	if err := s.repo.RevokeOpenInvites(ctx, member.ID); err != nil {
		return InviteResult{}, err
	}

	token, tokenHash, err := newOpaqueToken()
	if err != nil {
		return InviteResult{}, err
	}
	if err := s.repo.CreateInvite(ctx, member.ID, email, role, tokenHash, actor.ID,
		time.Now().Add(s.cfg.InviteTTL)); err != nil {
		return InviteResult{}, err
	}

	link := strings.TrimRight(s.cfg.AppBaseURL, "/") + "/invite/" + token
	sent := s.sendInvite(ctx, email, actor.FullName, link) && s.cfg.MailEnabled

	return InviteResult{Member: member, Link: link, Sent: sent}, nil
}

func (s *Service) sendInvite(ctx context.Context, email, inviter, link string) bool {
	body := fmt.Sprintf(
		"سلام،\n\n%s شما را به تخته کارهای تیم کتاپاد دعوت کرده است.\n\n"+
			"برای ساختن رمز عبور و ورود، این لینک را باز کنید:\n%s\n\n"+
			"این لینک تا %.0f ساعت دیگر معتبر است.\n",
		strings.TrimSpace(inviter), link, s.cfg.InviteTTL.Hours())

	if err := s.mail.Send(ctx, mailer.Message{
		To:      email,
		Subject: "دعوت به تخته کارهای کتاپاد",
		Body:    body,
	}); err != nil {
		// A failed send is not a failed invite: the link is in the
		// response either way, and losing the whole invite because a
		// mail host was down would be the worse outcome.
		s.log.WarnContext(ctx, "pm: invite email failed",
			slog.String("email", email), slog.String("error", err.Error()))
		return false
	}
	return true
}

// AcceptInvite turns an invite link into a working account. It is the
// only path that sets a password without knowing the old one.
func (s *Service) AcceptInvite(ctx context.Context, token, fullName, password, userAgent, ip string) (Tokens, error) {
	if err := validatePassword(password); err != nil {
		return Tokens{}, err
	}

	in, err := s.repo.InviteByTokenHash(ctx, hashToken(token))
	if err != nil {
		return Tokens{}, ErrInviteUsed
	}
	if time.Now().After(in.ExpiresAt) {
		return Tokens{}, ErrInviteUsed
	}

	hash, err := HashPassword(password)
	if err != nil {
		return Tokens{}, err
	}

	err = s.repo.InTx(ctx, func(tx *Repository) error {
		if err := tx.SetPassword(ctx, in.MemberID, hash); err != nil {
			return err
		}
		if name := strings.TrimSpace(fullName); name != "" {
			member, err := tx.MemberByID(ctx, in.MemberID)
			if err != nil {
				return err
			}
			if _, err := tx.UpdateMemberProfile(ctx, in.MemberID, name, member.Timezone, member.AvatarColor); err != nil {
				return err
			}
		}
		return tx.MarkInviteAccepted(ctx, in.ID)
	})
	if err != nil {
		return Tokens{}, err
	}

	member, err := s.EnsureActive(ctx, in.MemberID)
	if err != nil {
		return Tokens{}, err
	}
	return s.startSession(ctx, member, userAgent, ip)
}

// Bootstrap creates the very first account, and only the very first.
// Once one member exists this endpoint refuses forever — an internal
// tool with an open sign-up form is an internal tool with strangers in
// it.
func (s *Service) Bootstrap(ctx context.Context, email, fullName, password, userAgent, ip string) (Tokens, error) {
	count, err := s.repo.CountMembers(ctx)
	if err != nil {
		return Tokens{}, err
	}
	if count > 0 {
		return Tokens{}, ErrForbidden
	}

	email = strings.TrimSpace(strings.ToLower(email))
	if _, err := mail.ParseAddress(email); err != nil {
		return Tokens{}, fmt.Errorf("%w: ایمیل نامعتبر است", ErrValidation)
	}
	if err := validatePassword(password); err != nil {
		return Tokens{}, err
	}

	hash, err := HashPassword(password)
	if err != nil {
		return Tokens{}, err
	}

	member, err := s.repo.CreateMember(ctx, email, strings.TrimSpace(fullName), RoleOwner, avatarColorFor(email))
	if err != nil {
		return Tokens{}, err
	}
	if err := s.repo.SetPassword(ctx, member.ID, hash); err != nil {
		return Tokens{}, err
	}

	member.Status = StatusActive
	member.Role = RoleOwner
	return s.startSession(ctx, member, userAgent, ip)
}

// NeedsBootstrap tells the login screen whether to offer "create the
// first account" instead of a password field.
func (s *Service) NeedsBootstrap(ctx context.Context) (bool, error) {
	count, err := s.repo.CountMembers(ctx)
	return count == 0, err
}

// ── members ────────────────────────────────────────────────────────────

func (s *Service) ListMembers(ctx context.Context, actor Member) ([]Member, error) {
	members, err := s.repo.ListMembers(ctx, actor.CanAdmin())
	if err != nil {
		return nil, err
	}
	if members == nil {
		members = []Member{}
	}
	// Only an admin has any business seeing addresses; for everyone else
	// this list is an autocomplete for assigning and mentioning.
	if !actor.CanAdmin() {
		for i := range members {
			members[i].Email = ""
		}
	}
	return members, nil
}

func (s *Service) UpdateProfile(ctx context.Context, actor Member, fullName, timezone string) (Member, error) {
	fullName = strings.TrimSpace(fullName)
	if utf8.RuneCountInString(fullName) < 2 {
		return Member{}, fmt.Errorf("%w: نام باید حداقل دو نویسه باشد", ErrValidation)
	}
	if timezone == "" {
		timezone = actor.Timezone
	}
	return s.repo.UpdateMemberProfile(ctx, actor.ID, fullName, timezone, actor.AvatarColor)
}

func (s *Service) ChangePassword(ctx context.Context, actor Member, current, next string) error {
	if err := validatePassword(next); err != nil {
		return err
	}

	_, hash, err := s.repo.MemberByEmail(ctx, actor.Email)
	if err != nil {
		return err
	}
	if err := VerifyPassword(hash, current); err != nil {
		return ErrBadPassword
	}

	newHash, err := HashPassword(next)
	if err != nil {
		return err
	}
	if err := s.repo.SetPassword(ctx, actor.ID, newHash); err != nil {
		return err
	}

	// Changing a password is the action people take when they think
	// someone else has it. Every other session goes with it.
	return s.repo.RevokeAllSessions(ctx, actor.ID)
}

// UpdateMemberAccess is the admin screen: role and status.
func (s *Service) UpdateMemberAccess(ctx context.Context, actor Member, memberID, role, status string) (Member, error) {
	if !validRole(role) || !validStatus(status) {
		return Member{}, fmt.Errorf("%w: مقدار نامعتبر", ErrValidation)
	}
	if role == RoleOwner && actor.Role != RoleOwner {
		return Member{}, ErrForbidden
	}

	target, err := s.repo.MemberByID(ctx, memberID)
	if err != nil {
		return Member{}, err
	}

	// The last active owner cannot be demoted or disabled, by themselves
	// or by anyone. An instance with no owner can never invite again,
	// and the only fix is a hand-written UPDATE against production.
	if target.Role == RoleOwner && (role != RoleOwner || status != StatusActive) {
		others, err := s.repo.CountOwners(ctx, memberID)
		if err != nil {
			return Member{}, err
		}
		if others == 0 {
			return Member{}, fmt.Errorf("%w: آخرین مالک را نمی‌توان تغییر داد", ErrValidation)
		}
	}

	updated, err := s.repo.UpdateMemberAccess(ctx, memberID, role, status)
	if err != nil {
		return Member{}, err
	}
	if status != StatusActive {
		if err := s.repo.RevokeAllSessions(ctx, memberID); err != nil {
			return Member{}, err
		}
	}
	return updated, nil
}

// ── helpers ────────────────────────────────────────────────────────────

func validRole(role string) bool {
	switch role {
	case RoleOwner, RoleAdmin, RoleMember, RoleViewer:
		return true
	}
	return false
}

func validStatus(status string) bool {
	switch status {
	case StatusInvited, StatusActive, StatusDisabled:
		return true
	}
	return false
}

func validatePassword(password string) error {
	// Counted in runes: eight Persian characters is sixteen bytes, and a
	// byte-based rule would quietly demand twice as much of a Persian
	// speaker as of an English one.
	if utf8.RuneCountInString(password) < MinPasswordLength {
		return fmt.Errorf("%w: رمز عبور باید حداقل %d نویسه باشد", ErrValidation, MinPasswordLength)
	}
	return nil
}

// avatarColorFor derives a stable colour from the address so a new
// teammate has a recognisable avatar before anyone picks one. The
// palette is the design system's, minus the two colours 05-design-system
// reserves — saffron for kids, clay for errors.
func avatarColorFor(seed string) string {
	palette := []string{
		"#2FB8AE", "#4F9BE8", "#8A7CE0", "#D06BA8",
		"#3FA96B", "#C99A3F", "#5C8FB0", "#A0729E",
	}
	sum := sha256.Sum256([]byte(strings.ToLower(seed)))
	idx := binary.BigEndian.Uint32(sum[:4]) % uint32(len(palette))
	return palette[idx]
}
