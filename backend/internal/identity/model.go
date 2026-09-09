package identity

import "time"

// Status values for identity.users. A suspended or deleted user keeps a
// technically valid JWT until it expires, so every authenticated path
// re-checks status rather than trusting the token alone — see
// Service.EnsureActive.
const (
	StatusActive    = "active"
	StatusSuspended = "suspended"
	StatusDeleted   = "deleted"
)

const (
	RoleUser      = "user"
	RoleCreator   = "creator"
	RolePublisher = "publisher"
	RoleOrgAdmin  = "org_admin"
	RoleAdmin     = "admin"
)

type User struct {
	ID              string
	PhoneNumber     string
	FullName        string
	Email           string
	Role            string
	Roles           []string
	Status          string
	KidsModeEnabled bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (u User) IsActive() bool { return u.Status == StatusActive }

// HasRole checks the primary role column and the additive user_roles
// table together. A publisher who also listens has role='user' and a
// 'publisher' row; asking only one of the two gets the answer wrong.
func (u User) HasRole(role string) bool {
	if u.Role == role {
		return true
	}
	for _, r := range u.Roles {
		if r == role {
			return true
		}
	}
	return false
}

type Device struct {
	ID           string
	UserID       string
	Platform     string
	Name         string
	PushToken    string
	AppVersion   string
	Fingerprint  string
	LastActiveAt time.Time
	RevokedAt    *time.Time
}

type DeviceInfo struct {
	Platform    string
	Name        string
	PushToken   string
	AppVersion  string
	Fingerprint string
}

type TokenPair struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int64
	User         User
}

type OTPCode struct {
	ID           string
	PhoneNumber  string
	CodeHash     string
	Purpose      string
	AttemptCount int
	MaxAttempts  int
	ExpiresAt    time.Time
	ConsumedAt   *time.Time
}

type RefreshToken struct {
	ID        string
	UserID    string
	DeviceID  string
	FamilyID  string
	TokenHash string
	ExpiresAt time.Time
	RevokedAt *time.Time
	UsedAt    *time.Time
}

type ProfileUpdate struct {
	FullName *string
	Email    *string
}
