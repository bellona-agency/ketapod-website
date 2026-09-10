// Package mailer defines the outbound email boundary, mirroring the sms
// package: an interface, a stub that logs, and one real implementation.
//
// The pm tool needs it for exactly one thing that cannot work without
// it — an invite link has to reach a person who does not have an account
// yet. Everything else it sends (mention and assignment notices) is a
// convenience on top of the in-app bell, which is why LogSender is a
// legitimate way to run the tool rather than a placeholder: with no SMTP
// configured, the invite endpoint returns the link for the admin to
// paste into chat, and nothing else is lost.
package mailer

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"
)

type Message struct {
	To      string
	Subject string
	// Body is plain text. HTML email is a rendering problem with no
	// upside for a five-person internal tool, and plain text is the one
	// format no client mangles.
	Body string
}

type Sender interface {
	Send(ctx context.Context, msg Message) error
}

// LogSender writes the mail to the log instead of sending it. In
// development that is strictly better than a real send: the invite link
// ends up in the terminal the developer is already watching.
type LogSender struct {
	log *slog.Logger
}

func NewLogSender(log *slog.Logger) *LogSender { return &LogSender{log: log} }

func (s *LogSender) Send(ctx context.Context, msg Message) error {
	s.log.InfoContext(ctx, "mailer: log send",
		slog.String("to", msg.To),
		slog.String("subject", msg.Subject),
		slog.String("body", msg.Body),
	)
	return nil
}

type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	FromName string
	// StartTLS is the common case for Iranian mail hosts on port 587.
	// Port 465 is implicit TLS and is detected from the port rather than
	// configured separately.
	StartTLS bool
	Timeout  time.Duration
}

type SMTPSender struct {
	cfg Config
	log *slog.Logger
}

func NewSMTPSender(cfg Config, log *slog.Logger) *SMTPSender {
	if cfg.Timeout <= 0 {
		cfg.Timeout = 10 * time.Second
	}
	return &SMTPSender{cfg: cfg, log: log}
}

func (s *SMTPSender) Send(ctx context.Context, msg Message) error {
	addr := net.JoinHostPort(s.cfg.Host, fmt.Sprint(s.cfg.Port))

	dialer := &net.Dialer{Timeout: s.cfg.Timeout}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("mailer: dial %s: %w", addr, err)
	}

	// Port 465 speaks TLS from the first byte; 587 upgrades with
	// STARTTLS after EHLO. Getting this wrong produces a hang rather
	// than an error, so it is decided here from the port instead of
	// being left to a flag someone sets once and forgets.
	if s.cfg.Port == 465 {
		conn = tls.Client(conn, &tls.Config{ServerName: s.cfg.Host})
	}

	client, err := smtp.NewClient(conn, s.cfg.Host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("mailer: smtp client: %w", err)
	}
	defer func() { _ = client.Quit() }()

	if s.cfg.Port != 465 && s.cfg.StartTLS {
		if err := client.StartTLS(&tls.Config{ServerName: s.cfg.Host}); err != nil {
			return fmt.Errorf("mailer: starttls: %w", err)
		}
	}

	if s.cfg.Username != "" {
		auth := smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("mailer: auth: %w", err)
		}
	}

	if err := client.Mail(s.cfg.From); err != nil {
		return fmt.Errorf("mailer: from: %w", err)
	}
	if err := client.Rcpt(msg.To); err != nil {
		return fmt.Errorf("mailer: rcpt: %w", err)
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("mailer: data: %w", err)
	}
	if _, err := w.Write([]byte(s.render(msg))); err != nil {
		_ = w.Close()
		return fmt.Errorf("mailer: write: %w", err)
	}
	return w.Close()
}

// render builds the RFC 5322 message. The subject goes through
// mime.QEncoding because a Persian subject line is not ASCII, and an
// unencoded one arrives as mojibake in every client that follows the
// spec.
func (s *SMTPSender) render(msg Message) string {
	from := s.cfg.From
	if s.cfg.FromName != "" {
		from = mime.QEncoding.Encode("utf-8", s.cfg.FromName) + " <" + s.cfg.From + ">"
	}

	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", msg.To)
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", msg.Subject))
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n")
	b.WriteString("\r\n")
	b.WriteString(msg.Body)
	b.WriteString("\r\n")
	return b.String()
}
