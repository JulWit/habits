package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/JulWit/habits/internal/config"
	"github.com/JulWit/habits/internal/store"
)

// testWeb is a minimal frontend with an index.html template.
var testWeb = fstest.MapFS{
	"index.html": &fstest.MapFile{Data: []byte(
		`<!doctype html><html lang="{{.Lang}}" data-theme="{{.Theme}}" data-font="{{.Font}}"></html>`)},
	"assets/js/app.js": &fstest.MapFile{Data: []byte("export const x = 1;\n")},
	"manifest.webmanifest": &fstest.MapFile{Data: []byte(
		`{"name":"Habits","theme_color":"#e6e8ec","background_color":"#e6e8ec"}`)},
}

func newTestServer(t testing.TB) http.Handler {
	t.Helper()
	return newTestServerLogging(t, io.Discard)
}

// newTestServerLogging is newTestServer with its log written to w.
func newTestServerLogging(t testing.TB, w io.Writer) http.Handler {
	t.Helper()
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	cfg := config.Config{
		AuthMode:    config.AuthModeSingleUser,
		DefaultUser: "alice",
		UserHeader:  "Remote-User",
		Location:    time.UTC,
	}
	h, err := New(cfg, st, slog.New(slog.NewTextHandler(w, nil)), testWeb)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return h
}

func do(t *testing.T, h http.Handler, method, path, body, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestSecurityHeadersAreOnEveryResponse(t *testing.T) {
	h := newTestServer(t)
	for _, path := range []string{"/", "/api/state", "/healthz", "/assets/js/app.js"} {
		w := do(t, h, "GET", path, "", "")
		for header, want := range map[string]string{
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy":        "no-referrer",
		} {
			if got := w.Header().Get(header); got != want {
				t.Errorf("%s: %s = %q, want %q", path, header, got, want)
			}
		}
		csp := w.Header().Get("Content-Security-Policy")
		if !strings.Contains(csp, "script-src 'self'") {
			t.Errorf("%s: CSP without a strict script-src: %q", path, csp)
		}
		if !strings.Contains(csp, "frame-ancestors 'none'") {
			t.Errorf("%s: CSP without frame-ancestors: %q", path, csp)
		}
		// script-src must not allow inline scripts or eval.
		if strings.Contains(csp, "script-src 'self' 'unsafe") {
			t.Errorf("%s: script-src was loosened: %q", path, csp)
		}
	}
}

// index.html is rendered with the stored appearance settings.
func TestIndexCarriesTheStoredAppearance(t *testing.T) {
	h := newTestServer(t)

	if w := do(t, h, "PATCH", "/api/settings", `{"theme":"dark","font":"geist"}`, "application/json"); w.Code != http.StatusOK {
		t.Fatalf("writing settings: %d (%s)", w.Code, w.Body)
	}
	w := do(t, h, "GET", "/", "", "")
	if body := w.Body.String(); !strings.Contains(body, `data-theme="dark"`) ||
		!strings.Contains(body, `data-font="geist"`) {
		t.Errorf("shell without the stored appearance: %s", body)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
}

// /healthz requires no identity headers.
func TestHealthzNeedsNoIdentity(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "GET", "/healthz", "", "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "ok") {
		t.Errorf("healthz: %d %q", w.Code, w.Body)
	}
}

// Successful health checks are not logged, other requests are.
func TestHealthzIsNotLogged(t *testing.T) {
	var log strings.Builder
	h := newTestServerLogging(t, &log)
	do(t, h, "GET", "/healthz", "", "")
	do(t, h, "GET", "/api/state", "", "")
	if strings.Contains(log.String(), "/healthz") {
		t.Errorf("the health check was logged:\n%s", log.String())
	}
	if !strings.Contains(log.String(), "/api/state") {
		t.Errorf("other requests are no longer logged:\n%s", log.String())
	}
}

// "system" resolves to the first supported language in Accept-Language.
func TestResolveLanguage(t *testing.T) {
	cases := []struct{ chosen, accept, want string }{
		{"system", "de-DE,de;q=0.9,en;q=0.8", "de"},
		{"system", "fr-FR,fr;q=0.9,en-GB;q=0.8,de;q=0.7", "en"},
		{"system", "fr", "en"},
		{"system", "", "en"},
		{"de", "en-US", "de"},
		{"en", "de-DE", "en"},
	}
	for _, c := range cases {
		if got := resolveLanguage(c.chosen, c.accept); got != c.want {
			t.Errorf("resolveLanguage(%q, %q) = %q, want %q", c.chosen, c.accept, got, c.want)
		}
	}
}

// The language setting is applied to index.html; the time zone setting changes
// "today".
func TestLanguageAndTimeZoneSettings(t *testing.T) {
	h := newTestServer(t)

	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Accept-Language", "de-DE,de;q=0.9")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if !strings.Contains(w.Body.String(), `lang="de"`) {
		t.Errorf("shell without lang=\"de\": %s", w.Body.String())
	}

	if w := do(t, h, "PATCH", "/api/settings", `{"timeZone":"Mars/Olympus"}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("unknown zone: status %d, want 422", w.Code)
	}
	if w := do(t, h, "PATCH", "/api/settings", `{"language":"fr"}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("unknown language: status %d, want 422", w.Code)
	}

	// Kiritimati is UTC+14.
	if w := do(t, h, "PATCH", "/api/settings", `{"timeZone":"Pacific/Kiritimati","language":"en"}`, "application/json"); w.Code != http.StatusOK {
		t.Fatalf("setting zone: status %d: %s", w.Code, w.Body.String())
	}
	w = do(t, h, "GET", "/api/state", "", "")
	kiritimati, _ := time.LoadLocation("Pacific/Kiritimati")
	want := time.Now().In(kiritimati).Format("2006-01-02")
	if !strings.Contains(w.Body.String(), `"today":"`+want+`"`) {
		t.Errorf("today is not the zone's %s: %s", want, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"serverTimeZone":"UTC"`) {
		t.Errorf("state without the server zone")
	}
}

// Asset directories are not listed.
func TestAssetDirectoriesAreNotListed(t *testing.T) {
	h := newTestServer(t)
	for _, path := range []string{"/assets/", "/assets/js/", "/assets/js", "/assets/nope.js"} {
		if w := do(t, h, "GET", path, "", ""); w.Code != http.StatusNotFound {
			t.Errorf("GET %s: status %d, want 404", path, w.Code)
		}
	}
	if w := do(t, h, "GET", "/assets/js/app.js", "", ""); w.Code != http.StatusOK {
		t.Errorf("GET /assets/js/app.js: status %d, want 200", w.Code)
	}
}

// The manifest carries the colours of the stored theme.
func TestManifestFollowsTheStoredTheme(t *testing.T) {
	h := newTestServer(t)
	for theme, want := range map[string]string{"dark": "#0f0f0f", "light": "#e6e8ec", "system": "#e6e8ec"} {
		if w := do(t, h, "PATCH", "/api/settings", `{"theme":"`+theme+`"}`, "application/json"); w.Code != http.StatusOK {
			t.Fatalf("writing settings: %d (%s)", w.Code, w.Body)
		}
		w := do(t, h, "GET", "/manifest.webmanifest", "", "")
		if ct := w.Header().Get("Content-Type"); ct != "application/manifest+json" {
			t.Errorf("%s: Content-Type = %q", theme, ct)
		}
		var m map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
			t.Fatalf("%s: parsing manifest: %v (%s)", theme, err, w.Body)
		}
		if m["theme_color"] != want || m["background_color"] != want || m["name"] != "Habits" {
			t.Errorf("%s: manifest = %v, want colours %s", theme, m, want)
		}
	}
}

// For the "system" theme, the manifest follows the color_scheme cookie.
func TestManifestFollowsTheColorSchemeCookie(t *testing.T) {
	h := newTestServer(t)
	if w := do(t, h, "PATCH", "/api/settings", `{"theme":"system"}`, "application/json"); w.Code != http.StatusOK {
		t.Fatalf("writing settings: %d (%s)", w.Code, w.Body)
	}
	for cookie, want := range map[string]string{"dark": "#0f0f0f", "light": "#e6e8ec", "bogus": "#e6e8ec"} {
		r := httptest.NewRequest("GET", "/manifest.webmanifest", nil)
		r.AddCookie(&http.Cookie{Name: "color_scheme", Value: cookie})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		var m map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
			t.Fatalf("%s: parsing manifest: %v (%s)", cookie, err, w.Body)
		}
		if m["theme_color"] != want {
			t.Errorf("cookie %s: theme_color = %v, want %s", cookie, m["theme_color"], want)
		}
	}
}

// A request authentication refuses is answered with a problem details object
// like any other error, and never reaches the handlers.
func TestRefusedAuthenticationIsAProblem(t *testing.T) {
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	cfg := config.Config{
		AuthMode:   config.AuthModeTrustedHeader,
		UserHeader: "Remote-User",
		// httptest requests come from 192.0.2.1.
		TrustedProxies: []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")},
		Location:       time.UTC,
	}
	h, err := New(cfg, st, slog.New(slog.NewTextHandler(io.Discard, nil)), testWeb)
	if err != nil {
		t.Fatal(err)
	}

	w := do(t, h, "GET", "/api/state", "", "")
	var body problemBody
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("reading the answer: %v (%s)", err, w.Body)
	}
	if w.Code != http.StatusForbidden || body.Code != "untrusted_proxy" || body.Status != http.StatusForbidden ||
		!strings.HasPrefix(w.Header().Get("Content-Type"), "application/problem+json") {
		t.Errorf("status %d, Content-Type %q, body %+v", w.Code, w.Header().Get("Content-Type"), body)
	}
	if w.Header().Get("Content-Security-Policy") == "" {
		t.Error("the refusal has no security headers")
	}
}
