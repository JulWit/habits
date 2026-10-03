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

	// SQLite driver, registered by main in the program.
	_ "modernc.org/sqlite"
)

// testWeb is a minimal frontend with an index.html template.
var testWeb = fstest.MapFS{
	"index.html": &fstest.MapFile{Data: []byte(
		`<!doctype html><html lang="{{.Lang}}" data-theme="{{.Theme}}" data-font="{{.Font}}"></html>`)},
	"assets/js/app.js":        &fstest.MapFile{Data: []byte("export const x = 1;\n")},
	"assets/fonts/test.woff2": &fstest.MapFile{Data: []byte("wOF2")},
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
	return newTestServerWith(t, w, func(*config.Config) {})
}

// newTestServerWith is newTestServer with its log written to w and its
// configuration changed by adjust.
func newTestServerWith(t testing.TB, w io.Writer, adjust func(*config.Config)) http.Handler {
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
	adjust(&cfg)
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
		// script-src allows eval for Vue's template compiler, but no inline
		// scripts and no other origins.
		if !strings.Contains(csp, "script-src 'self' 'unsafe-eval';") {
			t.Errorf("%s: script-src is not exactly 'self' 'unsafe-eval': %q", path, csp)
		}
	}
}

// index.html is rendered with the stored appearance settings.
func TestIndexCarriesTheStoredAppearance(t *testing.T) {
	h := newTestServer(t)

	if w := do(t, h, "PATCH", "/api/settings", `{"theme":"dark","font":"geist"}`, "application/json"); w.Code != http.StatusOK {
		t.Fatalf("PATCH /api/settings: status %d, want 200 (%s)", w.Code, w.Body)
	}
	w := do(t, h, "GET", "/", "", "")
	body := w.Body.String()
	if !strings.Contains(body, `data-theme="dark"`) || !strings.Contains(body, `data-font="geist"`) {
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
		t.Errorf("GET /healthz: status %d, body %q; want 200, ok", w.Code, w.Body)
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
		t.Error("state without the server zone")
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

// Fonts are served as font/woff2 even where the host's MIME table lacks the
// extension.
func TestFontsHaveTheirContentType(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "GET", "/assets/fonts/test.woff2", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /assets/fonts/test.woff2: status %d, want 200", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "font/woff2" {
		t.Errorf("Content-Type = %q, want font/woff2", ct)
	}
}

// The manifest carries the colours of the stored theme.
func TestManifestFollowsTheStoredTheme(t *testing.T) {
	h := newTestServer(t)
	for theme, want := range map[string]string{"dark": "#0f0f0f", "light": "#e6e8ec", "system": "#e6e8ec"} {
		if w := do(t, h, "PATCH", "/api/settings", `{"theme":"`+theme+`"}`, "application/json"); w.Code != http.StatusOK {
			t.Fatalf("PATCH /api/settings: status %d, want 200 (%s)", w.Code, w.Body)
		}
		w := do(t, h, "GET", "/manifest.webmanifest", "", "")
		if ct := w.Header().Get("Content-Type"); ct != "application/manifest+json" {
			t.Errorf("%s: Content-Type = %q, want application/manifest+json", theme, ct)
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

// The manifest is in the user's language: the chosen one, or the browser's.
func TestManifestFollowsTheLanguage(t *testing.T) {
	h := newTestServer(t)
	for _, tc := range []struct {
		setting, accept, want string
	}{
		{"de", "en", "de"},
		{"system", "de-DE,de;q=0.9", "de"},
		{"system", "fr", "en"},
	} {
		if w := do(t, h, "PATCH", "/api/settings", `{"language":"`+tc.setting+`"}`, "application/json"); w.Code != http.StatusOK {
			t.Fatalf("PATCH /api/settings: status %d, want 200 (%s)", w.Code, w.Body)
		}
		r := httptest.NewRequest("GET", "/manifest.webmanifest", nil)
		r.Header.Set("Accept-Language", tc.accept)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		var m map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
			t.Fatalf("parsing manifest: %v (%s)", err, w.Body)
		}
		description, _ := m["description"].(string)
		german := strings.HasPrefix(description, "Gewohnheiten")
		if m["lang"] != tc.want || german != (tc.want == "de") {
			t.Errorf("%s/%s: lang %v, description %q; want %s", tc.setting, tc.accept, m["lang"], description, tc.want)
		}
	}
}

// For the "system" theme, the manifest follows the color_scheme cookie.
func TestManifestFollowsTheColorSchemeCookie(t *testing.T) {
	h := newTestServer(t)
	if w := do(t, h, "PATCH", "/api/settings", `{"theme":"system"}`, "application/json"); w.Code != http.StatusOK {
		t.Fatalf("PATCH /api/settings: status %d, want 200 (%s)", w.Code, w.Body)
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
		t.Fatalf("store.Open: %v", err)
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
		t.Fatalf("New: %v", err)
	}

	w := do(t, h, "GET", "/api/state", "", "")
	var body problemBody
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("reading the answer: %v (%s)", err, w.Body)
	}
	contentType := w.Header().Get("Content-Type")
	refused := w.Code == http.StatusForbidden && body.Status == http.StatusForbidden && body.Code == "untrusted_proxy"
	if !refused || !strings.HasPrefix(contentType, "application/problem+json") {
		t.Errorf("status %d, Content-Type %q, body %+v; want 403 untrusted_proxy as problem+json", w.Code, contentType, body)
	}
	if w.Header().Get("Content-Security-Policy") == "" {
		t.Error("the refusal has no security headers")
	}
}

// With AllowedHosts, a request to another host name is refused with 421,
// against DNS rebinding; IP addresses, the allowed names (with any port, case
// and a trailing dot) and /healthz are answered.
func TestOnlyAllowedHostsAreAnswered(t *testing.T) {
	h := newTestServerWith(t, io.Discard, func(cfg *config.Config) {
		cfg.AllowedHosts = []string{"localhost", "habits.example.com"}
	})
	get := func(host, path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		r.Host = host
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	for _, host := range []string{
		"localhost", "localhost:8080", "Habits.Example.com.", "habits.example.com:443",
		"127.0.0.1:8080", "192.168.1.20", "[::1]:8080",
	} {
		if w := get(host, "/api/state"); w.Code != http.StatusOK {
			t.Errorf("Host %q: status %d (%s), want 200", host, w.Code, w.Body)
		}
	}
	for _, host := range []string{"attacker.example", "attacker.example:8080", "localhost.attacker.example"} {
		for _, path := range []string{"/", "/api/state", "/api/export"} {
			w := get(host, path)
			var body problemBody
			json.Unmarshal(w.Body.Bytes(), &body)
			if w.Code != http.StatusMisdirectedRequest || body.Code != "host_not_allowed" {
				t.Errorf("Host %q, %s: status %d, code %q; want 421 host_not_allowed", host, path, w.Code, body.Code)
			}
		}
	}
	if w := get("attacker.example", "/healthz"); w.Code != http.StatusOK {
		t.Errorf("/healthz on another host: status %d, want 200", w.Code)
	}
}

// Without AllowedHosts, any host is answered.
func TestAnyHostWithoutAllowedHosts(t *testing.T) {
	h := newTestServer(t)
	r := httptest.NewRequest("GET", "/api/state", nil)
	r.Host = "whatever.example"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Errorf("status %d (%s), want 200", w.Code, w.Body)
	}
}

// A changing request a browser sends from another site is refused, even
// with a JSON body; one from the app's own origin, and one without the
// headers of a browser, is not.
func TestCrossOriginRequestsAreRefused(t *testing.T) {
	h := newTestServer(t)
	send := func(method, path string, headers map[string]string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(`{"name":"Read","kind":"check","frequency":{"kind":"daily"}}`))
		r.Header.Set("Content-Type", "application/json")
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	for _, headers := range []map[string]string{
		{"Sec-Fetch-Site": "cross-site"},
		{"Sec-Fetch-Site": "same-site"},
		{"Origin": "https://attacker.example"},
	} {
		for _, req := range []struct{ method, path string }{
			{"POST", "/api/habits"}, {"POST", "/api/undo"}, {"DELETE", "/api/data"},
		} {
			w := send(req.method, req.path, headers)
			var body problemBody
			json.Unmarshal(w.Body.Bytes(), &body)
			if w.Code != http.StatusForbidden || body.Code != "cross_origin" {
				t.Errorf("%s %s with %v: status %d, code %q; want 403 cross_origin",
					req.method, req.path, headers, w.Code, body.Code)
			}
		}
	}
	for _, headers := range []map[string]string{
		{"Sec-Fetch-Site": "same-origin"},
		{"Origin": "http://example.com"}, // httptest's host
		{},
	} {
		if w := send("POST", "/api/habits", headers); w.Code != http.StatusCreated {
			t.Errorf("POST /api/habits with %v: status %d (%s), want 201", headers, w.Code, w.Body)
		}
	}
	// Reading stays possible, e.g. for links opened from another site.
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Errorf("GET / from another site: status %d, want 200", w.Code)
	}
}

// Every response carries the ID of its request, and the request's log lines
// carry the ID and the user, the error of a handler included.
func TestRequestsAreLoggedWithIDAndUser(t *testing.T) {
	var log strings.Builder
	h := newTestServerLogging(t, &log)
	w := do(t, h, "GET", "/api/habits/unknown", "", "")
	id := w.Header().Get("X-Request-Id")
	if len(id) != 16 {
		t.Fatalf("X-Request-Id = %q, want 16 hex digits", id)
	}
	line := ""
	for l := range strings.Lines(log.String()) {
		if strings.Contains(l, "/api/habits/unknown") {
			line = l
		}
	}
	if !strings.Contains(line, "request="+id) || !strings.Contains(line, "user=alice") {
		t.Errorf("request line without ID %s and user alice: %q", id, line)
	}
	if other := do(t, h, "GET", "/api/state", "", "").Header().Get("X-Request-Id"); other == id {
		t.Errorf("two requests share the ID %s", id)
	}
}

// statusRecorder hands the ResponseWriter it wraps to
// http.ResponseController, which flushes through it.
func TestStatusRecorderUnwraps(t *testing.T) {
	w := httptest.NewRecorder()
	rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	if err := http.NewResponseController(rec).Flush(); err != nil {
		t.Fatalf("Flush through the recorder: %v", err)
	}
	if !w.Flushed {
		t.Error("the wrapped ResponseWriter was not flushed")
	}
}

// hostAllowed allows any host for nil, IP addresses always, and the allowed
// names regardless of port, case and a trailing dot.
func TestHostAllowed(t *testing.T) {
	allowed := []string{"localhost", "nas.local"}
	for host, want := range map[string]bool{
		"localhost":      true,
		"LOCALHOST:8080": true,
		"nas.local.":     true,
		"10.0.0.5":       true,
		"10.0.0.5:8080":  true,
		"[::1]:8080":     true,
		"::1":            true,
		"evil.example":   false,
		"nas.local.evil": false,
		"sub.localhost":  false,
		"":               false,
	} {
		if got := hostAllowed(allowed, host); got != want {
			t.Errorf("hostAllowed(%q) = %v, want %v", host, got, want)
		}
	}
	if !hostAllowed(nil, "evil.example") {
		t.Error("hostAllowed(nil, …) = false, want true")
	}
}
