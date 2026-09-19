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
		`<!doctype html><html data-theme="{{.Theme}}" data-font="{{.Font}}"></html>`)},
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
