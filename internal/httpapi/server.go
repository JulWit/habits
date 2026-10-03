// Package httpapi provides the JSON API and serves the embedded frontend.
package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"path"
	"runtime/debug"
	"slices"
	"strings"
	"sync"
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
	// zones caches the users' time zones by name (see location), as
	// time.LoadLocation reads and parses the zone on every call.
	zones sync.Map
}

// New returns the HTTP handler of the application. webFS contains the frontend
// with index.html at its root.
func New(cfg config.Config, st *store.Store, logger *slog.Logger, webFS fs.FS) (http.Handler, error) {
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
		log:      logger,
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

	// The health check requires no authentication, and answers on any host:
	// it reveals nothing, and the container asks it on the address it
	// listens on.
	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintln(w, "ok")
	})
	root.Handle("/", s.checkHost(s.authenticate(mux)))

	return s.logRequests(s.recoverPanics(securityHeaders(root))), nil
}

// checkHost refuses requests addressed to a host name that is not in
// cfg.AllowedHosts (see hostAllowed), so that a page of another site whose
// name resolves to this server (DNS rebinding) cannot read or change data.
func (s *server) checkHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hostAllowed(s.cfg.AllowedHosts, r.Host) {
			next.ServeHTTP(w, r)
			return
		}
		name := hostName(r.Host)
		s.logFor(r.Context()).Warn("host not allowed", "host", name, "peer", r.RemoteAddr)
		s.writeError(w, http.StatusMisdirectedRequest, "host_not_allowed",
			fmt.Sprintf("The host %q is not allowed; add it to HABITS_ALLOWED_HOSTS", name))
	})
}

// hostAllowed reports whether a request to host (the Host header, with or
// without port) may be answered: any host for a nil allowed, an IP address,
// or one of allowed, ignoring case and a trailing dot.
func hostAllowed(allowed []string, host string) bool {
	if allowed == nil {
		return true
	}
	name := hostName(host)
	if _, err := netip.ParseAddr(name); err == nil {
		return true
	}
	return slices.Contains(allowed, name)
}

// hostName returns the name of a Host header as HABITS_ALLOWED_HOSTS lists
// it: without port and brackets, in lower case, without a trailing dot.
func hostName(host string) string {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return strings.TrimSuffix(strings.ToLower(strings.Trim(host, "[]")), ".")
}

// contentSecurityPolicy is sent with every response. Inline styles are allowed
// because index.html and the Vue templates set style attributes; inline
// scripts are not. 'unsafe-eval' lets Vue compile the templates of the
// components in the browser (new Function), as the frontend has no build step.
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self' 'unsafe-eval'; " +
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
			s.logFor(r.Context()).Warn("authentication refused",
				"reason", refused.Reason,
				"peer", r.RemoteAddr,
				"path", r.URL.Path)
			s.writeError(w, refused.Status, refused.Code, refused.Message)
			return
		}
		if err != nil {
			s.logFor(r.Context()).Error("authentication failed", "error", err, "path", r.URL.Path)
			s.writeError(w, http.StatusInternalServerError, "internal", "Internal server error")
			return
		}
		if info := requestInfoFrom(r.Context()); info != nil {
			info.user = user.ID
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
			s.logFor(r.Context()).Error("handler registered without authentication", "path", r.URL.Path)
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
	}{
		Settings: prefs,
		Lang:     resolveLanguage(prefs.Language, r.Header.Get("Accept-Language")),
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := s.shell.Execute(w, data); err != nil {
		s.logFor(ctx).Error("rendering index failed", "error", err)
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

// loadBasis loads the user's settings in tx and derives the basis of their
// statistics from them.
func (s *server) loadBasis(ctx context.Context, tx *store.Tx) (basis, error) {
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
// chosen one or it is unknown. Zones are cached by name; only known ones
// are, a few hundred at most.
func (s *server) location(prefs settings.Settings) *time.Location {
	name := prefs.TimeZone
	if name == "" {
		return s.cfg.Location
	}
	if loc, ok := s.zones.Load(name); ok {
		return loc.(*time.Location)
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return s.cfg.Location
	}
	s.zones.Store(name, loc)
	return loc
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
		s.logFor(ctx).Error("loading settings failed", "error", err)
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

// requestInfo identifies a request in the log, so that the lines of one
// request can be told apart from those of another.
type requestInfo struct {
	// id is random, and sent in the header X-Request-Id.
	id string
	// user is the ID of the request's user, set by authenticate; "" before
	// and for refused requests.
	user string
}

// requestInfoKey is the context key of a request's *requestInfo.
type requestInfoKey struct{}

// requestInfoFrom returns the requestInfo logRequests stored in ctx, or nil.
func requestInfoFrom(ctx context.Context) *requestInfo {
	info, _ := ctx.Value(requestInfoKey{}).(*requestInfo)
	return info
}

// logFor returns the logger for the request of ctx: s.log with the request's
// ID and user, so a handler's error can be matched to its request line.
func (s *server) logFor(ctx context.Context) *slog.Logger {
	info := requestInfoFrom(ctx)
	if info == nil {
		return s.log
	}
	if info.user == "" {
		return s.log.With("request", info.id)
	}
	return s.log.With("request", info.id, "user", info.user)
}

// newRequestID returns a random ID of a request.
func newRequestID() string {
	var b [8]byte
	rand.Read(b[:]) // never fails since Go 1.24
	return hex.EncodeToString(b[:])
}

// logRequests logs every request with its ID, user, status and duration. The
// ID goes into the request's context (requestInfo) and into the header
// X-Request-Id of the response.
func (s *server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		info := &requestInfo{id: newRequestID()}
		w.Header().Set("X-Request-Id", info.id)
		r = r.WithContext(context.WithValue(r.Context(), requestInfoKey{}, info))
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
		s.logFor(r.Context()).Log(r.Context(), level, "request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration", time.Since(start).Round(time.Millisecond).String())
	})
}

// recoverPanics logs a panicking handler and answers with status 500. It
// runs inside logRequests, so the request is logged with that status.
func (s *server) recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				// ErrAbortHandler deliberately aborts the response; net/http handles it.
				if v == http.ErrAbortHandler {
					panic(v)
				}
				s.logFor(r.Context()).Error("panic in handler",
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
func (rec *statusRecorder) WriteHeader(code int) {
	if !rec.written {
		rec.status, rec.written = code, true
	}
	rec.ResponseWriter.WriteHeader(code)
}

// Write passes b on; a body written first implies the status 200, which the
// recorder keeps.
func (rec *statusRecorder) Write(b []byte) (int, error) {
	rec.written = true
	return rec.ResponseWriter.Write(b)
}

// Unwrap returns the wrapped ResponseWriter, so that http.ResponseController
// reaches its Flush and deadlines through the recorder.
func (rec *statusRecorder) Unwrap() http.ResponseWriter { return rec.ResponseWriter }

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
