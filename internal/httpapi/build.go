package httpapi

import (
	"runtime/debug"
	"sync"
)

// Set at link time, e.g. by the Dockerfile:
//
//	-ldflags "-X github.com/JulWit/habits/internal/httpapi.Version=1.2.3"
//
// Empty values are filled from the Go build information where possible.
var (
	// Version is the release, e.g. "1.2.3", or the branch it was built from.
	Version string
	// Revision is the full commit hash.
	Revision string
	// BuildTime is the build time in RFC 3339.
	BuildTime string
)

// buildInfo describes the running binary, for the settings' version page.
type buildInfo struct {
	// Version is "" for a development build.
	Version  string `json:"version"`
	Revision string `json:"revision"`
	// Time is the build time, or the commit time if that is unknown.
	Time string `json:"time"`
	// Modified reports uncommitted changes in the built tree.
	Modified  bool   `json:"modified"`
	GoVersion string `json:"goVersion"`
}

// currentBuild is computed once, as the build does not change at runtime.
var currentBuild = sync.OnceValue(func() buildInfo {
	b := buildInfo{Version: Version, Revision: Revision, Time: BuildTime}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return b
	}
	b.GoVersion = info.GoVersion
	// A module version is only set for go install of a tagged release.
	if b.Version == "" && info.Main.Version != "(devel)" {
		b.Version = info.Main.Version
	}
	// Stamped by go build inside a Git checkout.
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			if b.Revision == "" {
				b.Revision = s.Value
			}
		case "vcs.time":
			if b.Time == "" {
				b.Time = s.Value
			}
		case "vcs.modified":
			b.Modified = s.Value == "true"
		}
	}
	return b
})
