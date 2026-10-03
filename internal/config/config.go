// Package config loads the configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"net/netip"
	"os"
	"strings"
	"time"
)

// AuthMode determines how the user of a request is identified.
type AuthMode string

const (
	// AuthModeTrustedHeader reads the user from headers set by a trusted
	// reverse proxy after its authentication, e.g. with Authelia, Authentik or
	// oauth2-proxy.
	AuthModeTrustedHeader AuthMode = "trusted-header"
	// AuthModeSingleUser assigns every request to DefaultUser, without
	// authentication.
	AuthModeSingleUser AuthMode = "single-user"
)

// Config is the runtime configuration.
type Config struct {
	Addr         string
	DatabasePath string
	Location     *time.Location

	AuthMode AuthMode
	// UserHeader holds the user ID (Authelia and Authentik: Remote-User).
	UserHeader string
	// DisplayHeader and EmailHeader are optional.
	DisplayHeader string
	EmailHeader   string
	// TrustedProxies are the peers whose identity headers are accepted.
	// Required in trusted-header mode.
	TrustedProxies []netip.Prefix
	// DefaultUser is the user in single-user mode.
	DefaultUser string

	// AllowedHosts are the host names (lower case, without port) requests
	// may be addressed to, against DNS rebinding: a page of another site
	// whose name resolves to this server would otherwise act as this app.
	// IP addresses are always allowed, as such a page cannot use them as its
	// name. nil allows any host.
	AllowedHosts []string

	// UndoRetention is how long undo steps are kept, e.g. to bring back a
	// deleted habit.
	UndoRetention time.Duration
}

// defaultSingleUserHosts are the AllowedHosts of single-user mode without
// HABITS_ALLOWED_HOSTS: a server without authentication answers only on the
// loopback name and IP addresses. In trusted-header mode the reverse proxy
// routes by host name and signs in, so any host is allowed by default.
var defaultSingleUserHosts = []string{"localhost"}

// env returns the trimmed value of key, or fallback if it is unset or blank.
func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

// Load reads the configuration from the environment and validates it.
func Load() (Config, error) {
	cfg := Config{
		Addr:          env("HABITS_ADDR", "127.0.0.1:8080"),
		DatabasePath:  env("HABITS_DB", "habits.db"),
		AuthMode:      AuthMode(strings.ToLower(env("HABITS_AUTH_MODE", string(AuthModeSingleUser)))),
		UserHeader:    env("HABITS_USER_HEADER", "Remote-User"),
		DisplayHeader: env("HABITS_NAME_HEADER", "Remote-Name"),
		EmailHeader:   env("HABITS_EMAIL_HEADER", "Remote-Email"),
		DefaultUser:   env("HABITS_DEFAULT_USER", "local"),
		UndoRetention: 30 * 24 * time.Hour,
	}

	loc, err := time.LoadLocation(env("HABITS_TZ", "Local"))
	if err != nil {
		return Config{}, fmt.Errorf("HABITS_TZ: %w", err)
	}
	cfg.Location = loc

	switch cfg.AuthMode {
	case AuthModeSingleUser:
		if cfg.DefaultUser == "" {
			return Config{}, errors.New("HABITS_DEFAULT_USER must not be empty in single-user mode")
		}
	case AuthModeTrustedHeader:
		cfg.TrustedProxies, err = parsePrefixes(os.Getenv("HABITS_TRUSTED_PROXIES"))
		if err != nil {
			return Config{}, fmt.Errorf("HABITS_TRUSTED_PROXIES: %w", err)
		}
		if len(cfg.TrustedProxies) == 0 {
			return Config{}, errors.New(
				"HABITS_TRUSTED_PROXIES must be set in trusted-header mode " +
					"(e.g. 127.0.0.1/32,172.18.0.0/16) — otherwise any client could " +
					"set the Remote-User header itself")
		}
	default:
		return Config{}, fmt.Errorf("HABITS_AUTH_MODE: unknown value %q (allowed: trusted-header, single-user)", cfg.AuthMode)
	}

	if cfg.UserHeader == "" {
		return Config{}, errors.New("HABITS_USER_HEADER must not be empty")
	}

	if raw, ok := os.LookupEnv("HABITS_ALLOWED_HOSTS"); ok && strings.TrimSpace(raw) != "" {
		cfg.AllowedHosts = parseHosts(raw)
	} else if cfg.AuthMode == AuthModeSingleUser {
		cfg.AllowedHosts = defaultSingleUserHosts
	}
	return cfg, nil
}

// parseHosts parses a comma-separated list of host names, e.g.
// "habits.example.com,nas.local", into lower case without trailing dots. A
// "*" allows any host and yields nil.
func parseHosts(raw string) []string {
	var out []string
	for part := range strings.SplitSeq(raw, ",") {
		host := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(part)), ".")
		if host == "*" {
			return nil
		}
		if host != "" {
			out = append(out, host)
		}
	}
	return out
}

// parsePrefixes parses a comma-separated list of IP addresses and CIDR
// prefixes, e.g. "127.0.0.1,10.0.0.0/8".
func parsePrefixes(raw string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for part := range strings.SplitSeq(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "/") {
			p, err := netip.ParsePrefix(part)
			if err != nil {
				return nil, fmt.Errorf("%q is not a valid CIDR: %w", part, err)
			}
			out = append(out, p.Masked())
			continue
		}
		addr, err := netip.ParseAddr(part)
		if err != nil {
			return nil, fmt.Errorf("%q is not a valid IP address: %w", part, err)
		}
		out = append(out, netip.PrefixFrom(addr, addr.BitLen()))
	}
	return out, nil
}
