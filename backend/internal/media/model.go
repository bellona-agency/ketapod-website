package media

type AudioAsset struct {
	ID              string
	AudioEditionID  string
	StorageKey      string
	Format          string
	BitrateKbps     int
	DurationSeconds int
}
