package httpapi

import (
	"context"
	"encoding/json"
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

// A cross-site form can POST text/plain, urlencoded or multipart with no
// preflight, and any of those bodies can be valid JSON. Requiring the JSON
// content type is what forces a preflight, which same-origin policy then stops.
func TestMutationsRequireTheJSONContentType(t *testing.T) {
	h := newTestServer(t)
	habit := `{"name":"Reading","kind":"check","frequency":{"kind":"daily"}}`

	for _, ct := range []string{
		"text/plain",
		"text/plain;charset=UTF-8",
		"application/x-www-form-urlencoded",
		"multipart/form-data; boundary=x",
		"", // no header at all
	} {
		w := do(t, h, "POST", "/api/habits", habit, ct)
		if w.Code != http.StatusUnsupportedMediaType {
			t.Errorf("Content-Type %q: status %d, want 415", ct, w.Code)
		}
	}

	// The real thing still works, with or without a charset parameter.
	for _, ct := range []string{"application/json", "application/json; charset=utf-8"} {
		if w := do(t, h, "POST", "/api/habits", habit, ct); w.Code != http.StatusCreated {
			t.Errorf("Content-Type %q: status %d, want 201 (%s)", ct, w.Code, w.Body)
		}
	}
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

// The client needs these to read a stored value, which is why they are sent
// rather than mirrored in JavaScript.
func TestStateCarriesTheKindDescriptors(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "GET", "/api/state", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d (%s)", w.Code, w.Body)
	}

	var got struct {
		Colors []string `json:"colors"`
		Kinds  map[string]struct {
			Scale int    `json:"scale"`
			Step  int    `json:"step"`
			Max   int    `json:"max"`
			Unit  string `json:"unit"`
		} `json:"kinds"`
		BlurAtFull int `json:"blurAtFull"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	for _, kind := range []string{"check", "count", "time", "distance"} {
		if _, ok := got.Kinds[kind]; !ok {
			t.Errorf("kinds does not contain %q", kind)
		}
	}
	if got.Kinds["distance"].Scale != 1000 || got.Kinds["distance"].Max != 200000 {
		t.Errorf("distance = %+v", got.Kinds["distance"])
	}
	if got.Kinds["time"].Unit != "min" {
		t.Errorf("time.unit = %q, want min", got.Kinds["time"].Unit)
	}
	if got.BlurAtFull != store.BackgroundBlurAtFull {
		t.Errorf("blurAtFull = %d, want %d", got.BlurAtFull, store.BackgroundBlurAtFull)
	}
	if len(got.Colors) == 0 {
		t.Error("colors is empty")
	}
}

// An out-of-range value is the client's mistake, not the server's: 422, and a
// message rather than "Interner Serverfehler".
func TestBadSettingsAnswer422(t *testing.T) {
	h := newTestServer(t)
	for _, body := range []string{
		`{"theme":"neon"}`,
		`{"font":"comic-sans"}`,
		`{"overviewDays":999}`,
		`{"surfaceOpacity":0}`,
		`{"bandColor":"#123456"}`,
	} {
		w := do(t, h, "PATCH", "/api/settings", body, "application/json")
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: status %d, want 422", body, w.Code)
		}
		if strings.Contains(w.Body.String(), "Interner Serverfehler") {
			t.Errorf("%s: reported as a server error: %s", body, w.Body)
		}
	}
	// An unknown field is a typo in the client, and says so.
	if w := do(t, h, "PATCH", "/api/settings", `{"thme":"dark"}`, "application/json"); w.Code != http.StatusBadRequest {
		t.Errorf("unknown field: status %d, want 400", w.Code)
	}
}

// A day beyond the per-kind ceiling is refused with a reason, not a 500.
func TestEntryValueIsBounded(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"Running","kind":"distance","targetValue":5000,"frequency":{"kind":"daily"}}`,
		"application/json")
	if w.Code != http.StatusCreated {
		t.Fatalf("creating habit: %d (%s)", w.Code, w.Body)
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("reading response: %v", err)
	}

	path := "/api/habits/" + created.ID + "/entries/2026-09-18"
	if w := do(t, h, "PUT", path, `{"value":999999999}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("value too large: status %d, want 422 (%s)", w.Code, w.Body)
	}
	if w := do(t, h, "PUT", path, `{"value":-5}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("negative value: status %d, want 422", w.Code)
	}
	if w := do(t, h, "PUT", path, `{"value":5000}`, "application/json"); w.Code != http.StatusOK {
		t.Errorf("valid value: status %d, want 200 (%s)", w.Code, w.Body)
	}
	// Beyond the horizon is a different rejection, and also not a 500.
	far := "/api/habits/" + created.ID + "/entries/2099-01-01"
	if w := do(t, h, "PUT", far, `{"value":1000}`, "application/json"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("date beyond the horizon: status %d, want 422", w.Code)
	}
}

// Validation messages are read by a person in a dialog, so the sentinel prefix
// the layers below use to classify the error must not travel with them.
func TestValidationMessagesReachTheUserPlain(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"   ","kind":"check","frequency":{"kind":"daily"}}`, "application/json")
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422 (%s)", w.Code, w.Body)
	}
	var body struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	if strings.Contains(body.Error, "validation error") {
		t.Errorf("message carries the sentinel prefix: %q", body.Error)
	}
	if body.Error != "name must not be empty" {
		t.Errorf("message = %q", body.Error)
	}
}

// Changing the kind of a habit that has a history would silently reinterpret
// every one of its days, so it is refused — and the refusal says why, in the
// words the editor uses for the type.
func TestKindChangeWithHistoryIsRefusedReadably(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "POST", "/api/habits",
		`{"name":"Running","kind":"distance","targetValue":5000,"frequency":{"kind":"daily"}}`,
		"application/json")
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	if w := do(t, h, "PUT", "/api/habits/"+created.ID+"/entries/2026-09-18",
		`{"value":5200}`, "application/json"); w.Code != http.StatusOK {
		t.Fatalf("entry: %d (%s)", w.Code, w.Body)
	}

	w = do(t, h, "PATCH", "/api/habits/"+created.ID,
		`{"kind":"count","targetValue":80}`, "application/json")
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422 (%s)", w.Code, w.Body)
	}
	var body struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	for _, want := range []string{"Count", "1 day is already recorded"} {
		if !strings.Contains(body.Error, want) {
			t.Errorf("message %q does not mention %q", body.Error, want)
		}
	}
	if strings.Contains(body.Error, `"count"`) {
		t.Errorf("message shows the raw key: %q", body.Error)
	}

	// A second day switches the sentence to its plural form, which is the half
	// a reader sees most often and the half a naive "%d days" would get right
	// by accident.
	if w := do(t, h, "PUT", "/api/habits/"+created.ID+"/entries/2026-09-17",
		`{"value":4800}`, "application/json"); w.Code != http.StatusOK {
		t.Fatalf("second entry: %d (%s)", w.Code, w.Body)
	}
	w = do(t, h, "PATCH", "/api/habits/"+created.ID,
		`{"kind":"count","targetValue":80}`, "application/json")
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422 (%s)", w.Code, w.Body)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("reading response: %v", err)
	}
	if !strings.Contains(body.Error, "2 days are already recorded") {
		t.Errorf("message %q does not use the plural form", body.Error)
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

func TestUnknownAPIPathAnswersJSON(t *testing.T) {
	h := newTestServer(t)
	w := do(t, h, "GET", "/api/gibtesnicht", "", "")
	if w.Code != http.StatusNotFound {
		t.Errorf("status %d, want 404", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q, want JSON", ct)
	}
}
