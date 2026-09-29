// Package auth determines the user of a request, either a fixed user or from
// the identity headers set by a trusted reverse proxy. The HTTP server
// answers a rejected request and stores the user in the request's context.
package auth

import (
	"context"
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

// WithUser returns ctx carrying the user of its request.
func WithUser(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}

// MustUser returns the user stored by WithUser. It panics if there is none,
// as then the handler is registered without authentication.
func MustUser(ctx context.Context) User {
	u, ok := ctx.Value(ctxKey{}).(User)
	if !ok {
		panic("auth: handler registered without authentication")
	}
	return u
}

// Error is a rejected request: Status, Code and Message go to the client,
// Reason to the log.
type Error struct {
	Status  int
	Code    string
	Message string
	Reason  string
}

// Error returns the reason for the log; the client gets Message.
func (e *Error) Error() string { return e.Reason }

// Resolve determines the user of r according to cfg.AuthMode. In
// trusted-header mode, identity headers are accepted only from trusted
// proxies.
func Resolve(cfg config.Config, r *http.Request) (User, *Error) {
	if cfg.AuthMode == config.AuthModeSingleUser {
		return User{ID: cfg.DefaultUser, Name: cfg.DefaultUser}, nil
	}

	if !peerTrusted(cfg.TrustedProxies, r.RemoteAddr) {
		return User{}, &Error{
			Status:  http.StatusForbidden,
			Code:    "untrusted_proxy",
			Message: "access only through the configured reverse proxy",
			Reason:  "peer is not a trusted proxy",
		}
	}

	id := strings.TrimSpace(r.Header.Get(cfg.UserHeader))
	if id == "" {
		return User{}, &Error{
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
