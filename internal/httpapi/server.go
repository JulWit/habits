// Package httpapi provides the JSON API and serves the embedded frontend.
package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"runtime/debug"
	"strings"
	"time"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/config"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/settings"
	"github.com/JulWit/habits/internal/store"
)

// server holds the dependencies of the HTTP handlers.
type server struct {
	cfg    config.Config
	store  *store.Store
	log    *slog.Logger
	shell  *template.Template
	assets http.Handler
	// manifest is the parsed web app manifest, see handleManifest.
	manifest map[string]any
}

// New returns the HTTP handler of the application. webFS contains the frontend
// with index.html at its root.
func New(cfg config.Config, st *store.Store, log *slog.Logger, webFS fs.FS) (http.Handler, error) {
	shell, err := template.ParseFS(webFS, "index.html")
	if err != nil {
		return nil, fmt.Errorf("loading index.html: %w", err)
	}
	manifest, err := loadManifest(webFS)
	if err != nil {
		return nil, err
	}
	assets, err := newAssetHandler(webFS)
	if err != nil {
		return nil, err
	}
	s := &server{
		cfg:      cfg,
		store:    st,
		log:      log,
		shell:    shell,
		assets:   assets,
		manifest: manifest,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/state", s.withUser(s.handleState))
	mux.HandleFunc("GET /api/days", s.withUser(s.handleDays))
	mux.HandleFunc("POST /api/habits", s.withUser(s.handleCreateHabit))
	mux.HandleFunc("POST /api/habits/reorder", s.withUser(s.handleReorderHabits))
	mux.HandleFunc("GET /api/habits/{id}", s.withUser(s.handleGetHabit))
	mux.HandleFunc("PATCH /api/habits/{id}", s.withUser(s.handleUpdateHabit))
	mux.HandleFunc("DELETE /api/habits/{id}", s.withUser(s.handleDeleteHabit))
	mux.HandleFunc("GET /api/habits/{id}/totals", s.withUser(s.handleHabitTotals))
	mux.HandleFunc("PUT /api/habits/{id}/entries/{date}", s.withUser(s.handleSetEntry))
	mux.HandleFunc("POST /api/skips", s.withUser(s.handleSkipDays))
	mux.HandleFunc("POST /api/categories", s.withUser(s.handleCreateCategory))
	mux.HandleFunc("POST /api/categories/reorder", s.withUser(s.handleReorderCategories))
	mux.HandleFunc("PATCH /api/categories/{id}", s.withUser(s.handleUpdateCategory))
	mux.HandleFunc("DELETE /api/categories/{id}", s.withUser(s.handleDeleteCategory))
	mux.HandleFunc("POST /api/undo", s.withUser(s.handleUndo))
	mux.HandleFunc("POST /api/redo", s.withUser(s.handleRedo))
	mux.HandleFunc("GET /api/settings", s.withUser(s.handleGetSettings))
	mux.HandleFunc("PATCH /api/settings", s.withUser(s.handleUpdateSettings))
	mux.HandleFunc("GET /api/export", s.withUser(s.handleExport))
	mux.HandleFunc("POST /api/import", s.withUser(s.handleImport))
	mux.HandleFunc("DELETE /api/data", s.withUser(s.handleDeleteData))
	mux.HandleFunc("/api/", s.notFoundJSON)

	mux.HandleFunc("GET /{$}", s.withUser(s.handleIndex))
	mux.Handle("GET /assets/", s.assets)
	// Served from the root so that the service worker's scope covers "/".
	mux.HandleFunc("GET /manifest.webmanifest", s.withUser(s.handleManifest))
	mux.Handle("GET /sw.js", s.assets)

	// The health check requires no authentication.
	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintln(w, "ok")
	})
	root.Handle("/", s.authenticate(mux))

	return s.recoverPanics(s.logRequests(securityHeaders(root))), nil
}

// contentSecurityPolicy is sent with every response. Inline styles are allowed
// because index.html sets style attributes; inline scripts are not.
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data:; " +
	"font-src 'self'; " +
	"connect-src 'self'; " +
	"form-action 'self'; " +
	"frame-ancestors 'none'; " +
	"base-uri 'none'; " +
	"object-src 'none'"

// authenticate stores the user of each request in its context (auth.Resolve)
// and rejects requests without one.
func (s *server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, err := auth.Resolve(s.cfg, r)
		if refused, ok := errors.AsType[*auth.Error](err); ok {
			s.log.Warn("authentication refused",
				"reason", refused.Reason,
				"peer", r.RemoteAddr,
				"path", r.URL.Path)
			s.writeError(w, refused.Status, refused.Code, refused.Message)
			return
		}
		if err != nil {
			s.log.Error("authentication failed", "error", err, "path", r.URL.Path)
			s.writeError(w, http.StatusInternalServerError, "internal", "Internal server error")
			return
		}
		next.ServeHTTP(w, r.WithContext(auth.WithUser(r.Context(), user)))
	})
}

// userHandler is a handler that acts for the user of its request.
type userHandler func(w http.ResponseWriter, r *http.Request, user auth.User)

// withUser passes the user stored by authenticate to h. A request without
// one means h is registered outside of authenticate; it is answered with
// status 500.
func (s *server) withUser(h userHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := auth.UserFrom(r.Context())
		if !ok {
			s.log.Error("handler registered without authentication", "path", r.URL.Path)
			s.writeError(w, http.StatusInternalServerError, "internal", "Internal server error")
			return
		}
		h(w, r, user)
	}
}

// securityHeaders sets security headers on every response.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// handleIndex renders index.html with the user's appearance settings, so the
// page is styled correctly before any script runs.
func (s *server) handleIndex(w http.ResponseWriter, r *http.Request, user auth.User) {
	ctx := r.Context()
	prefs := s.settingsOf(ctx, user.ID)
	data := struct {
		settings.Settings
		Lang string
		// Options are the choices of the enumerated settings.
		Options map[string][]settings.Option
	}{
		Settings: prefs,
		Lang:     resolveLanguage(prefs.Language, r.Header.Get("Accept-Language")),
		Options:  settings.Options(),
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := s.shell.Execute(w, data); err != nil {
		s.log.Error("rendering index failed", "error", err)
	}
}

// basis is what a user's statistics depend on besides their entries.
type basis struct {
	settings settings.Settings
	// loc is the user's time zone, today the current date there.
	loc   *time.Location
	today domain.Date
	// windowDays is the number of days the completion rate covers, 0 for the
	// whole history.
	windowDays int
}

// basis loads the user's settings in tx and derives the basis of their
// statistics from them.
func (s *server) basis(ctx context.Context, tx *store.Tx) (basis, error) {
	prefs, err := tx.Settings(ctx)
	if err != nil {
		return basis{}, err
	}
	loc := s.location(prefs)
	return basis{
		settings:   prefs,
		loc:        loc,
		today:      domain.Today(loc),
		windowDays: prefs.RateWindowDays(),
	}, nil
}

// location returns the user's time zone, or the server's if the user has not
// chosen one.
func (s *server) location(prefs settings.Settings) *time.Location {
	if prefs.TimeZone != "" {
		if loc, err := time.LoadLocation(prefs.TimeZone); err == nil {
			return loc
		}
	}
	return s.cfg.Location
}

// settingsOf returns the user's settings, or the defaults if they cannot be
// loaded, for pages that are shown either way.
func (s *server) settingsOf(ctx context.Context, userID string) settings.Settings {
	var prefs settings.Settings
	err := s.store.View(ctx, userID, func(tx *store.Tx) error {
		var err error
		prefs, err = tx.Settings(ctx)
		return err
	})
	if err != nil {
		s.log.Error("loading settings failed", "error", err, "user", userID)
		return settings.Default()
	}
	return prefs
}

// resolveLanguage returns the UI language. For "system" it returns the first
// supported language in Accept-Language, or "en".
func resolveLanguage(chosen, acceptLanguage string) string {
	if chosen != "system" && settings.IsOption("language", chosen) {
		return chosen
	}
	for part := range strings.SplitSeq(acceptLanguage, ",") {
		tag, _, _ := strings.Cut(strings.TrimSpace(part), ";")
		primary, _, _ := strings.Cut(strings.ToLower(tag), "-")
		if primary != "system" && settings.IsOption("language", primary) {
			return primary
		}
	}
	return "en"
}

// logRequests logs every request with its status and duration.
func (s *server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		// The container's health check asks every 30 seconds; its answers are not
		// worth a line each. A failing check is still logged.
		if r.URL.Path == "/healthz" && rec.status == http.StatusOK {
			return
		}
		level := slog.LevelInfo
		if rec.status >= 500 {
			level = slog.LevelError
		}
		s.log.Log(r.Context(), level, "request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration", time.Since(start).Round(time.Millisecond).String())
	})
}

// recoverPanics logs a panicking handler and answers with status 500.
func (s *server) recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				// ErrAbortHandler deliberately aborts the response; net/http handles it.
				if v == http.ErrAbortHandler {
					panic(v)
				}
				s.log.Error("panic in handler",
					"value", v, "path", r.URL.Path, "stack", string(debug.Stack()))
				s.writeError(w, http.StatusInternalServerError, "internal", "Internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// statusRecorder records the status code written to a ResponseWriter.
type statusRecorder struct {
	http.ResponseWriter
	status  int
	written bool
}

// WriteHeader records the status of the first call and passes it on.
func (r *statusRecorder) WriteHeader(code int) {
	if !r.written {
		r.status, r.written = code, true
	}
	r.ResponseWriter.WriteHeader(code)
}

// Write passes b on; a body written first implies the status 200, which the
// recorder keeps.
func (r *statusRecorder) Write(b []byte) (int, error) {
	r.written = true
	return r.ResponseWriter.Write(b)
}

// assetTypes are the content types of asset extensions that may be missing
// from the host's MIME table (e.g. on Windows). The asset handler sets them
// itself instead of changing the process-wide table (mime.AddExtensionType).
var assetTypes = map[string]string{
	".woff2": "font/woff2",
}

// newAssetHandler serves the files of webFS with an ETag derived from their
// content, since embedded files have no modification time.
func newAssetHandler(webFS fs.FS) (http.Handler, error) {
	etags := map[string]string{}
	err := fs.WalkDir(webFS, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		content, err := fs.ReadFile(webFS, name)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(content)
		etags[name] = `"` + hex.EncodeToString(sum[:8]) + `"`
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("hashing assets: %w", err)
	}

	files := http.FileServerFS(webFS)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Serve files only, no directory listings.
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		tag, ok := etags[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		// A Content-Type set here takes precedence over the file server's guess.
		if contentType, ok := assetTypes[path.Ext(name)]; ok {
			w.Header().Set("Content-Type", contentType)
		}
		w.Header().Set("ETag", tag)
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	}), nil
}
