package auth

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"

	"github.com/JulWit/habits/internal/config"
)

func mustPrefix(t *testing.T, s string) netip.Prefix {
	t.Helper()
	p, err := netip.ParsePrefix(s)
	if err != nil {
		t.Fatalf("ParsePrefix(%q): %v", s, err)
	}
	return p
}

func autheliaConfig(t *testing.T, trusted ...string) config.Config {
	t.Helper()
	cfg := config.Config{
		AuthMode:      config.AuthModeAuthelia,
		UserHeader:    "Remote-User",
		DisplayHeader: "Remote-Name",
		EmailHeader:   "Remote-Email",
		GroupsHeader:  "Remote-Groups",
	}
	for _, s := range trusted {
		cfg.TrustedProxies = append(cfg.TrustedProxies, mustPrefix(t, s))
	}
	return cfg
}

// run sends one request through the middleware and reports what the handler saw.
func run(cfg config.Config, prepare func(*http.Request)) (*httptest.ResponseRecorder, User, bool) {
	var seen User
	var reached bool
	h := Middleware(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seen, _ = FromContext(r.Context())
			reached = true
		}))

	r := httptest.NewRequest("GET", "/api/state", nil)
	prepare(r)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w, seen, reached
}

func TestSingleUserIgnoresHeaders(t *testing.T) {
	cfg := config.Config{
		AuthMode:    config.AuthModeSingleUser,
		DefaultUser: "local",
		UserHeader:  "Remote-User",
	}
	_, user, reached := run(cfg, func(r *http.Request) {
		// A header in this mode means nothing; the user is pinned.
		r.Header.Set("Remote-User", "admin")
	})
	if !reached {
		t.Fatal("die Anfrage kam nicht beim Handler an")
	}
	if user.ID != "local" {
		t.Errorf("user.ID = %q, want local — der Header darf hier nichts entscheiden", user.ID)
	}
}

// The header is only believed from a configured proxy. Without this check
// anyone who can open a socket to the port could name themselves.
func TestUntrustedPeerIsRefused(t *testing.T) {
	cfg := autheliaConfig(t, "172.18.0.0/16")
	for _, peer := range []string{"10.0.0.5:5000", "203.0.113.9:443", "[2001:db8::1]:443"} {
		w, _, reached := run(cfg, func(r *http.Request) {
			r.RemoteAddr = peer
			r.Header.Set("Remote-User", "admin")
		})
		if reached {
			t.Errorf("%s: der Handler wurde trotzdem erreicht", peer)
		}
		// 403, not 401: the request did not fail to authenticate, it came from
		// somewhere it must never come from.
		if w.Code != http.StatusForbidden {
			t.Errorf("%s: status %d, want 403", peer, w.Code)
		}
	}
}

func TestTrustedPeerIsBelieved(t *testing.T) {
	cfg := autheliaConfig(t, "172.18.0.0/16", "127.0.0.1/32")
	for _, peer := range []string{"172.18.0.7:40000", "127.0.0.1:40000"} {
		w, user, reached := run(cfg, func(r *http.Request) {
			r.RemoteAddr = peer
			r.Header.Set("Remote-User", "Alice")
		})
		if !reached {
			t.Errorf("%s: abgewiesen mit %d", peer, w.Code)
			continue
		}
		// Lower-cased, so "Alice" and "alice" cannot own two separate sets.
		if user.ID != "alice" {
			t.Errorf("%s: user.ID = %q, want alice", peer, user.ID)
		}
	}
}

// A proxy on the same host often connects as ::ffff:127.0.0.1, which has to
// match a 127.0.0.1/32 entry.
func TestIPv4MappedPeerMatchesItsIPv4Prefix(t *testing.T) {
	cfg := autheliaConfig(t, "127.0.0.1/32")
	_, _, reached := run(cfg, func(r *http.Request) {
		r.RemoteAddr = "[::ffff:127.0.0.1]:40000"
		r.Header.Set("Remote-User", "alice")
	})
	if !reached {
		t.Error("der IPv4-gemappte Peer wurde nicht als vertrauenswürdig erkannt")
	}
}

// A trusted proxy that sends no identity is a session that has expired, which
// is a 401 — a different thing from arriving at the wrong door.
func TestTrustedPeerWithoutIdentityIs401(t *testing.T) {
	cfg := autheliaConfig(t, "127.0.0.1/32")
	for _, header := range []string{"", "   "} {
		w, _, reached := run(cfg, func(r *http.Request) {
			r.RemoteAddr = "127.0.0.1:40000"
			if header != "" {
				r.Header.Set("Remote-User", header)
			}
		})
		if reached {
			t.Errorf("Header %q: der Handler wurde erreicht", header)
		}
		if w.Code != http.StatusUnauthorized {
			t.Errorf("Header %q: status %d, want 401", header, w.Code)
		}
	}
}

func TestOptionalHeadersAreCarriedThrough(t *testing.T) {
	cfg := autheliaConfig(t, "127.0.0.1/32")
	_, user, reached := run(cfg, func(r *http.Request) {
		r.RemoteAddr = "127.0.0.1:40000"
		r.Header.Set("Remote-User", "alice")
		r.Header.Set("Remote-Name", "Alice Example")
		r.Header.Set("Remote-Email", "alice@example.com")
		r.Header.Set("Remote-Groups", " admins , users ,, ")
	})
	if !reached {
		t.Fatal("abgewiesen")
	}
	if user.Name != "Alice Example" || user.Email != "alice@example.com" {
		t.Errorf("Name/Email: %q / %q", user.Name, user.Email)
	}
	if len(user.Groups) != 2 || user.Groups[0] != "admins" || user.Groups[1] != "users" {
		t.Errorf("Groups = %#v, want [admins users] — leere Einträge fallen weg", user.Groups)
	}
}

// Without a display name the identifier stands in, so the UI always has
// something to greet.
func TestNameFallsBackToTheIdentifier(t *testing.T) {
	cfg := autheliaConfig(t, "127.0.0.1/32")
	_, user, _ := run(cfg, func(r *http.Request) {
		r.RemoteAddr = "127.0.0.1:40000"
		r.Header.Set("Remote-User", "Alice")
	})
	if user.Name != "Alice" {
		t.Errorf("Name = %q, want Alice", user.Name)
	}
}

// A handler mounted outside the middleware is a programming error, and should
// say so loudly rather than quietly acting as nobody.
func TestMustUserPanicsWithoutMiddleware(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("MustUser hat ohne Middleware nicht paniziert")
		}
	}()
	MustUser(httptest.NewRequest("GET", "/", nil).Context())
}

func TestPeerTrusted(t *testing.T) {
	trusted := []netip.Prefix{
		mustPrefix(t, "10.0.0.0/8"),
		mustPrefix(t, "127.0.0.1/32"),
	}
	for _, tc := range []struct {
		addr string
		want bool
	}{
		{"10.1.2.3:1234", true},
		{"127.0.0.1:1234", true},
		{"10.0.0.1", true}, // no port at all
		{"11.0.0.1:1234", false},
		{"127.0.0.2:1234", false},
		{"nicht-eine-adresse", false},
		{"", false},
	} {
		if got := peerTrusted(trusted, tc.addr); got != tc.want {
			t.Errorf("peerTrusted(%q) = %v, want %v", tc.addr, got, tc.want)
		}
	}
	// An empty list trusts nobody, which is what makes the config guard matter.
	if peerTrusted(nil, "127.0.0.1:1234") {
		t.Error("eine leere Liste darf niemandem vertrauen")
	}
}
