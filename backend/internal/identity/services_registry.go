package identity

// ServiceEntry is one tile in the super-app shell's service registry
// (03-product-surfaces.md). The shell reads this at startup and decides
// which modules to warm up, so availability is computed here in Go and
// never in the client — the same rule that keeps kids policy on the
// server keeps this here.
type ServiceEntry struct {
	ID            string `json:"id"`
	Order         int    `json:"order"`
	Enabled       bool   `json:"enabled"`
	Badge         string `json:"badge,omitempty"`
	MinAppVersion string `json:"minAppVersion"`
	Reason        string `json:"reason,omitempty"`
	CTA           *CTA   `json:"cta,omitempty"`
}

type CTA struct {
	Label string `json:"label"`
	Route string `json:"route"`
}

// ServicesFor returns the registry for one user. minAppVersion matters
// more in Iran than elsewhere: Cafe Bazaar users update late
// (03-product-surfaces.md), so the shell must be able to hide a service
// from an old build rather than crash inside it.
func ServicesFor(user User, hasChildProfiles bool) []ServiceEntry {
	listen := ServiceEntry{ID: "listen", Order: 1, Enabled: true, MinAppVersion: "1.0.0"}

	// Kids is enabled once a parent has actually created a child profile.
	// Showing an empty kids tile to every adult is how a super-app starts
	// feeling like a directory instead of a product; the CTA routes the
	// parent to profile creation instead.
	kids := ServiceEntry{ID: "kids", Order: 2, Enabled: hasChildProfiles, MinAppVersion: "1.2.0"}
	if hasChildProfiles {
		kids.Badge = "new"
	} else {
		kids.Reason = "no_child_profile"
		kids.CTA = &CTA{Label: "create_child_profile", Route: "/kids/profiles/new"}
	}

	studio := ServiceEntry{ID: "studio", Order: 3, MinAppVersion: "1.4.0"}
	if user.HasRole(RoleCreator) || user.HasRole(RolePublisher) || user.HasRole(RoleAdmin) {
		studio.Enabled = true
	} else {
		studio.Reason = "creator_role_required"
		studio.CTA = &CTA{Label: "apply", Route: "/studio/apply"}
	}

	return []ServiceEntry{listen, kids, studio}
}
