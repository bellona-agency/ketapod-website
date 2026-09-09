package home

type Stat struct {
	Key          string
	Label        string
	Value        int64
	DisplayValue string
}

type DemoSample struct {
	BookID string
	AITag  string
}

type DemoContinueListening struct {
	ID              string
	BookID          string
	ProgressPercent int
}

type DemoRecommendation struct {
	ID     string
	BookID string
	Tag    string
	Type   string
}

type LocalizationContent struct {
	Title    string
	Subtitle string
}

type LocalizationLanguage struct {
	Code  string
	Label string
}

type LocalizationSample struct {
	ID       string
	Title    string
	CoverURL string
	Language string
}

type SocialProofStat struct {
	Label string
	Value string
}

type Testimonial struct {
	ID        string
	Name      string
	Role      string
	Message   string
	AvatarURL string
}

type Partner struct {
	ID      string
	Name    string
	LogoURL string
}

type Utm struct {
	Source   string
	Medium   string
	Campaign string
}

type LeadInput struct {
	FullName     string
	PhoneNumber  string
	Email        string
	UserType     string
	InterestTags []string
	Consent      bool
	Source       string
	LandingPath  string
	Referrer     string
	UTM          Utm
}

type Lead struct {
	ID string
}
