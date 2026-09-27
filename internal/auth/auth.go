// Package auth determines the user of a request, either a fixed user or from
// the identity headers set by a trusted reverse proxy.
package auth

import (
	"context"
	"encoding/json"
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

// MustUser returns the user stored by Middleware. It panics if there is none,
// as then the handler is registered without Middleware.
func MustUser(ctx context.Context) User {
	u, ok := ctx.Value(ctxKey{}).(User)
	if !ok {
		panic("auth: handler registered without auth.Middleware")
	}
	return u
}

// Middleware stores the user of each request in its context and rejects
// requests without one. In trusted-header mode, identity headers are accepted only
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
				writeProblem(w, err)
				return
			}
			ctx := context.WithValue(r.Context(), ctxKey{}, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// authError is a rejected request: Status, Code and Message go to the client,
// Reason to the log.
type authError struct {
	Status  int
	Code    string
	Message string
	Reason  string
}

// writeProblem answers a rejected request with a problem details object, in
// the format of the API's other errors.
func writeProblem(w http.ResponseWriter, e *authError) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(e.Status)
	json.NewEncoder(w).Encode(map[string]any{
		"title": http.StatusText(e.Status), "status": e.Status, "code": e.Code, "detail": e.Message,
	})
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
			Code:    "untrusted_proxy",
			Message: "access only through the configured reverse proxy",
			Reason:  "peer is not a trusted proxy",
		}
	}

	id := strings.TrimSpace(r.Header.Get(cfg.UserHeader))
	if id == "" {
		return User{}, &authError{
			Status:  http.StatusUnauthorized,
			Code:    "not_signed_in",
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
		for part := range strings.SplitSeq(g, ",") {
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
