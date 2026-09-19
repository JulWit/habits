package config

import (
	"net/netip"
	"strings"
	"testing"
)

// withEnv sets the given variables for one test and clears every other
// HABITS_* one, so a case never inherits a neighbour's environment.
func withEnv(t *testing.T, vars map[string]string) {
	t.Helper()
	for _, key := range []string{
		"HABITS_ADDR", "HABITS_DB", "HABITS_TZ", "HABITS_AUTH_MODE",
		"HABITS_DEFAULT_USER", "HABITS_TRUSTED_PROXIES", "HABITS_USER_HEADER",
		"HABITS_NAME_HEADER", "HABITS_EMAIL_HEADER", "HABITS_GROUPS_HEADER",
	} {
		t.Setenv(key, "")
	}
	for key, value := range vars {
		t.Setenv(key, value)
	}
}

func TestLoadDefaultsToSingleUser(t *testing.T) {
	withEnv(t, nil)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.AuthMode != AuthModeSingleUser {
		t.Errorf("AuthMode = %q, want single-user", cfg.AuthMode)
	}
	if cfg.Addr != ":8080" || cfg.DatabasePath != "habits.db" || cfg.DefaultUser != "local" {
		t.Errorf("Defaults: %+v", cfg)
	}
	if cfg.UserHeader != "Remote-User" {
		t.Errorf("UserHeader = %q", cfg.UserHeader)
	}
	if cfg.Location == nil {
		t.Error("Location is nil")
	}
	if cfg.DeletedRetention <= 0 {
		t.Errorf("DeletedRetention = %v", cfg.DeletedRetention)
	}
}

// Whitespace-only is the same as unset: a value like HABITS_ADDR=" " comes from
// a compose file with an empty interpolation, not from an intent.
func TestBlankEnvFallsBackToTheDefault(t *testing.T) {
	withEnv(t, map[string]string{"HABITS_ADDR": "   ", "HABITS_DB": "  data.db  "})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Addr != ":8080" {
		t.Errorf("Addr = %q, want the default", cfg.Addr)
	}
	if cfg.DatabasePath != "data.db" {
		t.Errorf("DatabasePath = %q, want trimmed", cfg.DatabasePath)
	}
}

// The guard that makes header auth safe at all: without a trusted-proxy list
// any client reaching the port could send its own Remote-User.
func TestAutheliaRefusesToStartWithoutTrustedProxies(t *testing.T) {
	withEnv(t, map[string]string{"HABITS_AUTH_MODE": "authelia"})
	_, err := Load()
	if err == nil {
		t.Fatal("authelia without HABITS_TRUSTED_PROXIES was accepted")
	}
	if !strings.Contains(err.Error(), "HABITS_TRUSTED_PROXIES") {
		t.Errorf("the error message does not name the variable: %v", err)
	}
}

func TestAutheliaParsesTrustedProxies(t *testing.T) {
	withEnv(t, map[string]string{
		"HABITS_AUTH_MODE":       "AUTHELIA", // case must not matter
		"HABITS_TRUSTED_PROXIES": "127.0.0.1, 172.18.0.0/16 ,10.0.0.0/8",
	})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.AuthMode != AuthModeAuthelia {
		t.Errorf("AuthMode = %q", cfg.AuthMode)
	}
	if len(cfg.TrustedProxies) != 3 {
		t.Fatalf("%d prefixes, want 3: %v", len(cfg.TrustedProxies), cfg.TrustedProxies)
	}
	// A bare address becomes a single-host prefix.
	if got := cfg.TrustedProxies[0]; got.Bits() != 32 || got.Addr().String() != "127.0.0.1" {
		t.Errorf("first prefix = %v, want 127.0.0.1/32", got)
	}
	if !cfg.TrustedProxies[1].Contains(netip.MustParseAddr("172.18.5.9")) {
		t.Errorf("172.18.0.0/16 does not cover 172.18.5.9")
	}
}

func TestLoadRejects(t *testing.T) {
	for _, tc := range []struct {
		name string
		env  map[string]string
		says string
	}{
		{"unknown auth mode",
			map[string]string{"HABITS_AUTH_MODE": "oauth"}, "HABITS_AUTH_MODE"},
		{"unknown time zone",
			map[string]string{"HABITS_TZ": "Mars/Olympus_Mons"}, "HABITS_TZ"},
		{"broken CIDR", map[string]string{
			"HABITS_AUTH_MODE": "authelia", "HABITS_TRUSTED_PROXIES": "172.18.0.0/99",
		}, "HABITS_TRUSTED_PROXIES"},
		{"not an IP", map[string]string{
			"HABITS_AUTH_MODE": "authelia", "HABITS_TRUSTED_PROXIES": "proxy.example.com",
		}, "HABITS_TRUSTED_PROXIES"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			withEnv(t, tc.env)
			_, err := Load()
			if err == nil {
				t.Fatal("was accepted")
			}
			if !strings.Contains(err.Error(), tc.says) {
				t.Errorf("message does not mention %q: %v", tc.says, err)
			}
		})
	}
}

// The embedded tzdata is what makes this work on a host without a zoneinfo of
// its own — Windows has none, and a scratch container usually has none either.
func TestNamedTimezoneResolves(t *testing.T) {
	withEnv(t, map[string]string{"HABITS_TZ": "Europe/Berlin"})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Location.String() != "Europe/Berlin" {
		t.Errorf("Location = %q", cfg.Location)
	}
}
