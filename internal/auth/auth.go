// Package auth determines the user of a request, either a fixed user or from
// the identity headers set by Authelia.
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

// User is the user of a request. All data is scoped by ID.
type User struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Email  string   `json:"email"`
	Groups []string `json:"groups"`
}

type ctxKey struct{}

// FromContext returns the user stored by Middleware.
func FromContext(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(ctxKey{}).(User)
	return u, ok
}

// MustUser is like FromContext but panics if there is no user.
func MustUser(ctx context.Context) User {
	u, ok := FromContext(ctx)
	if !ok {
		panic("auth: handler registered without auth.Middleware")
	}
	return u
}

// Middleware stores the user of each request in its context and rejects
// requests without one. In authelia mode, identity headers are accepted only
// from trusted proxies.
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

// authError is a rejected request: Status and Message go to the client,
// Reason to the log.
type authError struct {
	Status  int
	Message string
	Reason  string
}

func (e *authError) Error() string { return e.Reason }

// resolve determines the user of r according to cfg.AuthMode.
func resolve(cfg config.Config, r *http.Request) (User, *authError) {
	if cfg.AuthMode == config.AuthModeSingleUser {
		return User{ID: cfg.DefaultUser, Name: cfg.DefaultUser}, nil
	}

	if !peerTrusted(cfg.TrustedProxies, r.RemoteAddr) {
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
			Message: "Not signed in",
			Reason:  "header " + cfg.UserHeader + " is missing or empty",
		}
	}

	u := User{
		// Lower case, so that "Alice" and "alice" are the same user.
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

// peerTrusted reports whether remoteAddr lies in one of the trusted prefixes.
func peerTrusted(trusted []netip.Prefix, remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	addr, err := netip.ParseAddr(strings.Trim(host, "[]"))
	if err != nil {
		return false
	}
	// Unmap so that ::ffff:127.0.0.1 matches 127.0.0.1/32.
	addr = addr.Unmap()
	for _, p := range trusted {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}
