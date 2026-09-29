package auth

import (
	"errors"
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

func trustedHeaderConfig(t *testing.T, trusted ...string) config.Config {
	t.Helper()
	cfg := config.Config{
		AuthMode:      config.AuthModeTrustedHeader,
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

// run resolves the user of one request and reports the status of a rejected
// one, or the user and true.
func run(cfg config.Config, prepare func(*http.Request)) (status int, user User, reached bool) {
	r := httptest.NewRequest("GET", "/api/state", nil)
	prepare(r)
	user, err := Resolve(cfg, r)
	if err != nil {
		var refused *Error
		if !errors.As(err, &refused) {
			return http.StatusInternalServerError, User{}, false
		}
		return refused.Status, User{}, false
	}
	return http.StatusOK, user, true
}

func TestSingleUserIgnoresHeaders(t *testing.T) {
	cfg := config.Config{
		AuthMode:    config.AuthModeSingleUser,
		DefaultUser: "local",
		UserHeader:  "Remote-User",
	}
	_, user, reached := run(cfg, func(r *http.Request) {
		// In single-user mode the header is ignored.
		r.Header.Set("Remote-User", "admin")
	})
	if !reached {
		t.Fatal("the request never reached the handler")
	}
	if user.ID != "local" {
		t.Errorf("user.ID = %q, want local — the header must decide nothing here", user.ID)
	}
}

// Identity headers from untrusted peers are rejected.
func TestUntrustedPeerIsRefused(t *testing.T) {
	cfg := trustedHeaderConfig(t, "172.18.0.0/16")
	for _, peer := range []string{"10.0.0.5:5000", "203.0.113.9:443", "[2001:db8::1]:443"} {
		status, _, reached := run(cfg, func(r *http.Request) {
			r.RemoteAddr = peer
			r.Header.Set("Remote-User", "admin")
		})
		if reached {
			t.Errorf("%s: the handler was reached anyway", peer)
		}
		// 403, not 401: the peer is not allowed at all.
		if status != http.StatusForbidden {
			t.Errorf("%s: status %d, want 403", peer, status)
		}
	}
}

func TestTrustedPeerIsBelieved(t *testing.T) {
	cfg := trustedHeaderConfig(t, "172.18.0.0/16", "127.0.0.1/32")
	for _, peer := range []string{"172.18.0.7:40000", "127.0.0.1:40000"} {
		status, user, reached := run(cfg, func(r *http.Request) {
			r.RemoteAddr = peer
			r.Header.Set("Remote-User", "Alice")
		})
		if !reached {
			t.Errorf("%s: rejected with %d", peer, status)
			continue
		}
		// User IDs are lower-cased.
		if user.ID != "alice" {
			t.Errorf("%s: user.ID = %q, want alice", peer, user.ID)
		}
	}
}

// ::ffff:127.0.0.1 matches 127.0.0.1/32.
func TestIPv4MappedPeerMatchesItsIPv4Prefix(t *testing.T) {
	cfg := trustedHeaderConfig(t, "127.0.0.1/32")
	_, _, reached := run(cfg, func(r *http.Request) {
		r.RemoteAddr = "[::ffff:127.0.0.1]:40000"
		r.Header.Set("Remote-User", "alice")
	})
	if !reached {
		t.Error("the IPv4-mapped peer was not recognised as trusted")
	}
}

// A trusted peer without a user header gets 401.
func TestTrustedPeerWithoutIdentityIs401(t *testing.T) {
	cfg := trustedHeaderConfig(t, "127.0.0.1/32")
	for _, header := range []string{"", "   "} {
		status, _, reached := run(cfg, func(r *http.Request) {
			r.RemoteAddr = "127.0.0.1:40000"
			if header != "" {
				r.Header.Set("Remote-User", header)
			}
		})
		if reached {
			t.Errorf("header %q: the handler was reached", header)
		}
		if status != http.StatusUnauthorized {
			t.Errorf("Header %q: status %d, want 401", header, status)
		}
	}
}

func TestOptionalHeadersAreCarriedThrough(t *testing.T) {
	cfg := trustedHeaderConfig(t, "127.0.0.1/32")
	_, user, reached := run(cfg, func(r *http.Request) {
		r.RemoteAddr = "127.0.0.1:40000"
		r.Header.Set("Remote-User", "alice")
		r.Header.Set("Remote-Name", "Alice Example")
		r.Header.Set("Remote-Email", "alice@example.com")
		r.Header.Set("Remote-Groups", " admins , users ,, ")
	})
	if !reached {
		t.Fatal("Resolve rejected a trusted peer with an identity, want it accepted")
	}
	if user.Name != "Alice Example" || user.Email != "alice@example.com" {
		t.Errorf(`Name, Email = %q, %q; want "Alice Example", "alice@example.com"`, user.Name, user.Email)
	}
	if len(user.Groups) != 2 || user.Groups[0] != "admins" || user.Groups[1] != "users" {
		t.Errorf("Groups = %#v, want [admins users] — empty entries are dropped", user.Groups)
	}
}

// Without a display name, the user ID is used as the name.
func TestNameFallsBackToTheIdentifier(t *testing.T) {
	cfg := trustedHeaderConfig(t, "127.0.0.1/32")
	_, user, _ := run(cfg, func(r *http.Request) {
		r.RemoteAddr = "127.0.0.1:40000"
		r.Header.Set("Remote-User", "Alice")
	})
	if user.Name != "Alice" {
		t.Errorf("Name = %q, want Alice", user.Name)
	}
}

// UserFrom finds the user stored by WithUser and reports a missing one.
func TestUserFrom(t *testing.T) {
	ctx := httptest.NewRequest("GET", "/", nil).Context()
	if u, ok := UserFrom(ctx); ok {
		t.Errorf("UserFrom without WithUser = %+v, true; want false", u)
	}
	want := User{ID: "alice", Name: "Alice"}
	if got, ok := UserFrom(WithUser(ctx, want)); !ok || got.ID != want.ID || got.Name != want.Name {
		t.Errorf("UserFrom = %+v, %v; want %+v, true", got, ok, want)
	}
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
		{"not-an-address", false},
		{"", false},
	} {
		if got := peerTrusted(trusted, tc.addr); got != tc.want {
			t.Errorf("peerTrusted(%q) = %v, want %v", tc.addr, got, tc.want)
		}
	}
	// An empty list trusts nobody.
	if peerTrusted(nil, "127.0.0.1:1234") {
		t.Error("an empty list must trust nobody")
	}
}
