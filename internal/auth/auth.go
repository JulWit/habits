// Package auth turns Authelia's forward-auth headers into a request-scoped
// user. The application deliberately has no accounts of its own: identity is
// owned by Authelia, and this package only decides whom the request belongs to.
package auth

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strings"

	"github.com/JulWit/habits/internal/config"
)

// User is the identity a request acts under. ID is the scope key for all data;
// everything else is cosmetic.
type User struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Email  string   `json:"email"`
	Groups []string `json:"groups"`
}

type ctxKey struct{}

// FromContext returns the authenticated user. The second result is false only
// if the handler was mounted outside Middleware, which is a programming error.
func FromContext(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(ctxKey{}).(User)
	return u, ok
}

// MustUser is for handlers that are always mounted behind Middleware.
func MustUser(ctx context.Context) User {
	u, ok := FromContext(ctx)
	if !ok {
		panic("auth: handler ohne auth.Middleware eingebunden")
	}
	return u
}

// Middleware resolves the user for every request.
//
// In authelia mode the identity headers are only believed when the immediate
// peer is a configured trusted proxy. Header-based auth is otherwise trivially
// forgeable: anyone able to open a TCP connection to the port could claim to be
// any user simply by setting Remote-User themselves.
func Middleware(cfg config.Config, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, err := resolve(cfg, r)
			if err != nil {
				log.Warn("authentication refused",
					"reason", err.Error(),
					"peer", r.RemoteAddr,
					"path", r.URL.Path)
				http.Error(w, err.Message, err.Status)
				return
			}
			ctx := context.WithValue(r.Context(), ctxKey{}, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

type authError struct {
	Status  int
	Message string
	Reason  string
}

func (e *authError) Error() string { return e.Reason }

func resolve(cfg config.Config, r *http.Request) (User, *authError) {
	if cfg.AuthMode == config.AuthModeSingleUser {
		return User{ID: cfg.DefaultUser, Name: cfg.DefaultUser}, nil
	}

	if !peerTrusted(cfg.TrustedProxies, r.RemoteAddr) {
		// Deliberately 403 and not 401: the request did not fail to
		// authenticate, it arrived from somewhere it must never arrive from.
		return User{}, &authError{
			Status:  http.StatusForbidden,
			Message: "access only through the configured reverse proxy",
			Reason:  "peer is not a trusted proxy",
		}
	}

	id := strings.TrimSpace(r.Header.Get(cfg.UserHeader))
	if id == "" {
		return User{}, &authError{
			Status:  http.StatusUnauthorized,
			Message: "Nicht angemeldet",
			Reason:  "header " + cfg.UserHeader + " is missing or empty",
		}
	}

	u := User{
		// Lower-cased so that "Alice" and "alice" cannot end up owning two
		// separate sets of habits.
		ID:    strings.ToLower(id),
		Name:  strings.TrimSpace(r.Header.Get(cfg.DisplayHeader)),
		Email: strings.TrimSpace(r.Header.Get(cfg.EmailHeader)),
	}
	if u.Name == "" {
		u.Name = id
	}
	if g := strings.TrimSpace(r.Header.Get(cfg.GroupsHeader)); g != "" {
		for _, part := range strings.Split(g, ",") {
			if part = strings.TrimSpace(part); part != "" {
				u.Groups = append(u.Groups, part)
			}
		}
	}
	return u, nil
}

func peerTrusted(trusted []netip.Prefix, remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	addr, err := netip.ParseAddr(strings.Trim(host, "[]"))
	if err != nil {
		return false
	}
	// A proxy on the same host often connects over IPv6-mapped IPv4; compare
	// the unmapped form so 127.0.0.1/32 also matches ::ffff:127.0.0.1.
	addr = addr.Unmap()
	for _, p := range trusted {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}
