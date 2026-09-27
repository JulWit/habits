package config

import (
	"net/netip"
	"strings"
	"testing"
)

// withEnv sets vars for the duration of the test and clears all other HABITS_*
// variables.
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

// A blank value is treated like an unset one.
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

// Trusted-header mode requires HABITS_TRUSTED_PROXIES.
func TestTrustedHeaderRefusesToStartWithoutTrustedProxies(t *testing.T) {
	withEnv(t, map[string]string{"HABITS_AUTH_MODE": "trusted-header"})
	_, err := Load()
	if err == nil {
		t.Fatal("trusted-header without HABITS_TRUSTED_PROXIES was accepted")
	}
	if !strings.Contains(err.Error(), "HABITS_TRUSTED_PROXIES") {
		t.Errorf("the error message does not name the variable: %v", err)
	}
}

func TestTrustedHeaderParsesTrustedProxies(t *testing.T) {
	withEnv(t, map[string]string{
		"HABITS_AUTH_MODE":       "Trusted-Header", // case must not matter
		"HABITS_TRUSTED_PROXIES": "127.0.0.1, 172.18.0.0/16 ,10.0.0.0/8",
	})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.AuthMode != AuthModeTrustedHeader {
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
			"HABITS_AUTH_MODE": "trusted-header", "HABITS_TRUSTED_PROXIES": "172.18.0.0/99",
		}, "HABITS_TRUSTED_PROXIES"},
		{"not an IP", map[string]string{
			"HABITS_AUTH_MODE": "trusted-header", "HABITS_TRUSTED_PROXIES": "proxy.example.com",
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

// Named time zones resolve via the embedded tzdata.
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
