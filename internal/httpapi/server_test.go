package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/JulWit/habits/internal/config"
	"github.com/JulWit/habits/internal/store"
)

// The shell is a template, so the test FS has to carry one that executes. Only
// the fields handleIndex actually writes are referenced.
var testWeb = fstest.MapFS{
	"index.html": &fstest.MapFile{Data: []byte(
		`<!doctype html><html lang="{{.Lang}}" data-theme="{{.Theme}}" data-font="{{.Font}}"></html>`)},
	"assets/js/app.js": &fstest.MapFile{Data: []byte("export const x = 1;\n")},
}

func newTestServer(t *testing.T) http.Handler {
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
	h, err := New(cfg, st, slog.New(slog.NewTextHandler(io.Discard, nil)), testWeb)
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
		// The whole point of the strict script-src is that nothing needs
		// 'unsafe-inline' or 'unsafe-eval' there.
		if strings.Contains(csp, "script-src 'self' 'unsafe") {
			t.Errorf("%s: script-src was loosened: %q", path, csp)
		}
	}
}

// The shell is rendered server-side so the page paints in the stored theme
// rather than flashing the default first.
func TestIndexCarriesTheStoredAppearance(t *testing.T) {
	h := newTestServer(t)

	if w := do(t, h, "PATCH", "/api/settings", `{"theme":"dark","font":"lato"}`, "application/json"); w.Code != http.StatusOK {
		t.Fatalf("writing settings: %d (%s)", w.Code, w.Body)
	}
	w := do(t, h, "GET", "/", "", "")
	if body := w.Body.String(); !strings.Contains(body, `data-theme="dark"`) ||
		!strings.Contains(body, `data-font="lato"`) {
		t.Errorf("shell without the stored appearance: %s", body)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
}

// The health check has to answer without identity headers, so a container
// probe does not need to carry them.
func TestHealthzNeedsNoIdentity(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "GET", "/healthz", "", "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "ok") {
		t.Errorf("healthz: %d %q", w.Code, w.Body)
	}
}

// "system" takes the first translated language the browser names; anything
// else is taken as chosen.
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

// The shell carries the language, and a time zone of one's own moves "today".
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

	// Kiritimati is UTC+14: for most of the day it is already tomorrow there.
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

// The asset handler serves files and nothing else: a directory is not
// answered with a listing of what is in it.
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
