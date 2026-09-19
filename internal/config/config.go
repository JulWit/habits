// Package config loads the runtime configuration from the environment. Every
// setting has an env var so the binary stays a single self-contained artefact
// with no config file to ship alongside it.
package config

import (
	"errors"
	"fmt"
	"net/netip"
	"os"
	"strings"
	"time"
)

type AuthMode string

const (
	// AuthModeAuthelia trusts identity headers set by a reverse proxy that has
	// already run Authelia's forward-auth endpoint.
	AuthModeAuthelia AuthMode = "authelia"
	// AuthModeSingleUser skips authentication entirely and pins every request
	// to one fixed user. Intended for local development and for instances that
	// are already behind another access control layer.
	AuthModeSingleUser AuthMode = "single-user"
)

type Config struct {
	Addr         string
	DatabasePath string
	Location     *time.Location

	AuthMode AuthMode
	// UserHeader carries the stable user identifier (Authelia: Remote-User).
	UserHeader string
	// DisplayHeader and EmailHeader are optional niceties for the UI.
	DisplayHeader string
	EmailHeader   string
	GroupsHeader  string
	// TrustedProxies lists the peers allowed to assert identity headers.
	// Without it any client that can reach the port could simply send its own
	// Remote-User, so authelia mode refuses to start with an empty list.
	TrustedProxies []netip.Prefix
	DefaultUser    string

	// DeletedRetention is how long soft-deleted habits stay restorable.
	DeletedRetention time.Duration
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

// Load reads the configuration and fails loudly on anything ambiguous rather
// than falling back to a less safe default.
func Load() (Config, error) {
	cfg := Config{
		Addr:             env("HABITS_ADDR", ":8080"),
		DatabasePath:     env("HABITS_DB", "habits.db"),
		AuthMode:         AuthMode(strings.ToLower(env("HABITS_AUTH_MODE", string(AuthModeSingleUser)))),
		UserHeader:       env("HABITS_USER_HEADER", "Remote-User"),
		DisplayHeader:    env("HABITS_NAME_HEADER", "Remote-Name"),
		EmailHeader:      env("HABITS_EMAIL_HEADER", "Remote-Email"),
		GroupsHeader:     env("HABITS_GROUPS_HEADER", "Remote-Groups"),
		DefaultUser:      env("HABITS_DEFAULT_USER", "local"),
		DeletedRetention: 30 * 24 * time.Hour,
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
	case AuthModeAuthelia:
		cfg.TrustedProxies, err = parsePrefixes(os.Getenv("HABITS_TRUSTED_PROXIES"))
		if err != nil {
			return Config{}, fmt.Errorf("HABITS_TRUSTED_PROXIES: %w", err)
		}
		if len(cfg.TrustedProxies) == 0 {
			return Config{}, errors.New(
				"HABITS_TRUSTED_PROXIES must be set in authelia mode " +
					"(e.g. 127.0.0.1/32,172.18.0.0/16) — otherwise any client could " +
					"set the Remote-User header itself")
		}
	default:
		return Config{}, fmt.Errorf("HABITS_AUTH_MODE: unknown value %q (allowed: authelia, single-user)", cfg.AuthMode)
	}

	if cfg.UserHeader == "" {
		return Config{}, errors.New("HABITS_USER_HEADER must not be empty")
	}
	return cfg, nil
}

// parsePrefixes accepts both bare addresses and CIDR notation, so
// "127.0.0.1,10.0.0.0/8" works as written.
func parsePrefixes(raw string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, part := range strings.Split(raw, ",") {
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
