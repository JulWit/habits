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
	// AuthModeAuthelia reads the user from headers set by a trusted reverse
	// proxy with Authelia.
	AuthModeAuthelia AuthMode = "authelia"
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
	// UserHeader holds the user ID (Authelia: Remote-User).
	UserHeader string
	// DisplayHeader, EmailHeader and GroupsHeader are optional.
	DisplayHeader string
	EmailHeader   string
	GroupsHeader  string
	// TrustedProxies are the peers whose identity headers are accepted.
	// Required in authelia mode.
	TrustedProxies []netip.Prefix
	// DefaultUser is the user in single-user mode.
	DefaultUser string

	// DeletedRetention is how long deleted habits and categories can be
	// restored.
	DeletedRetention time.Duration
}

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

// parsePrefixes parses a comma-separated list of IP addresses and CIDR
// prefixes, e.g. "127.0.0.1,10.0.0.0/8".
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
