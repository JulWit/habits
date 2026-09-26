// Package httpapi exposes the application over HTTP: a small JSON API plus the
// embedded single-page frontend.
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
	"mime"
	"net/http"
	"path"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/JulWit/habits/internal/auth"
	"github.com/JulWit/habits/internal/config"
	"github.com/JulWit/habits/internal/domain"
	"github.com/JulWit/habits/internal/store"
)

type Server struct {
	cfg    config.Config
	store  *store.Store
	log    *slog.Logger
	shell  *template.Template
	assets http.Handler
}

// New wires the routes. webFS is the embedded frontend, rooted at the directory
// holding index.html.
func New(cfg config.Config, st *store.Store, log *slog.Logger, webFS fs.FS) (http.Handler, error) {
	shell, err := template.ParseFS(webFS, "index.html")
	if err != nil {
		return nil, fmt.Errorf("loading index.html: %w", err)
	}
	assets, err := newAssetHandler(webFS)
	if err != nil {
		return nil, err
	}
	s := &Server{
		cfg:    cfg,
		store:  st,
		log:    log,
		shell:  shell,
		assets: assets,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/state", s.handleState)
	mux.HandleFunc("POST /api/habits", s.handleCreateHabit)
	mux.HandleFunc("POST /api/habits/reorder", s.handleReorderHabits)
	mux.HandleFunc("GET /api/habits/{id}", s.handleGetHabit)
	mux.HandleFunc("PATCH /api/habits/{id}", s.handleUpdateHabit)
	mux.HandleFunc("DELETE /api/habits/{id}", s.handleDeleteHabit)
	mux.HandleFunc("POST /api/habits/{id}/restore", s.handleRestoreHabit)
	mux.HandleFunc("PUT /api/habits/{id}/entries/{date}", s.handleSetEntry)
	mux.HandleFunc("POST /api/categories", s.handleCreateCategory)
	mux.HandleFunc("POST /api/categories/reorder", s.handleReorderCategories)
	mux.HandleFunc("PATCH /api/categories/{id}", s.handleUpdateCategory)
	mux.HandleFunc("DELETE /api/categories/{id}", s.handleDeleteCategory)
	mux.HandleFunc("POST /api/categories/{id}/restore", s.handleRestoreCategory)
	mux.HandleFunc("GET /api/settings", s.handleGetSettings)
	mux.HandleFunc("PATCH /api/settings", s.handleUpdateSettings)
	mux.HandleFunc("GET /api/background", s.handleGetBackground)
	mux.HandleFunc("PUT /api/background", s.handlePutBackground)
	mux.HandleFunc("DELETE /api/background", s.handleDeleteBackground)
	mux.HandleFunc("/api/", notFoundJSON)

	mux.HandleFunc("GET /{$}", s.handleIndex)
	mux.Handle("GET /assets/", s.assets)
	// Both have to answer from the root: a manifest is looked up relative to
	// the page, and a service worker may only control the paths below its own.
	// One under /assets/ could never see "/".
	mux.Handle("GET /manifest.webmanifest", s.assets)
	mux.Handle("GET /sw.js", s.assets)

	// The health check sits outside the auth middleware so a container probe
	// does not need to carry identity headers.
	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintln(w, "ok")
	})
	root.Handle("/", auth.Middleware(cfg, log)(mux))

	return s.recoverPanics(s.logRequests(securityHeaders(root))), nil
}

// contentSecurityPolicy is what the page actually needs, and nothing else.
//
// script-src can be strict because there is not one inline script in the shell:
// everything is a module under /assets. Styles cannot, because the shell writes
// the stored appearance into a style attribute before any script runs, which is
// the whole point of rendering it server-side — an inline style is parsed
// markup and needs 'unsafe-inline' where a CSSOM write from a module would not.
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

// securityHeaders sets the handful of headers that are worth having on a
// self-hosted single-binary app. They go on every response, including the
// assets and the health check, because a header that is only sometimes there is
// a header nobody can rely on.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		// The asset handler states a media type for every file it serves;
		// this stops a browser from second-guessing any of them.
		h.Set("X-Content-Type-Options", "nosniff")
		// A habit name must not travel to anyone in a Referer, and nothing
		// here links out.
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// handleIndex renders the app shell with the stored theme, typeface and density
// baked in, so the page paints in the right colours, font and spacing
// immediately instead of flashing the defaults first.
func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUser(r.Context())
	settings, err := s.store.GetSettings(r.Context(), user.ID)
	if err != nil {
		s.log.Error("loading settings failed", "error", err, "user", user.ID)
		settings = store.DefaultSettings()
	}
	data := struct {
		Lang       string
		Theme      string
		Font       string
		Density    string
		Pattern    string
		BandColor  string
		BandOp     int
		BandFillOp int
		ShowBand   bool
		Dim        int
		Blur       string
		SurfaceOp  int
		SurfaceBlr string
		User       string
	}{
		Lang:       resolveLanguage(settings.Language, r.Header.Get("Accept-Language")),
		Theme:      settings.Theme,
		Font:       settings.Font,
		Density:    settings.Density,
		Pattern:    settings.Pattern,
		BandColor:  settings.BandColor,
		BandOp:     settings.BandOpacity,
		BandFillOp: settings.BandFillOpacity,
		ShowBand:   settings.ShowBand,
		Dim:        settings.BackgroundDim,
		// The stylesheet needs a length where the setting is a percentage, and
		// the shell is the one place that has to get it right before any script
		// runs. The client scales it with the same number.
		Blur: strconv.FormatFloat(
			float64(settings.BackgroundBlur)*store.BackgroundBlurAtFull/100, 'f', -1, 64),
		SurfaceOp: settings.SurfaceOpacity,
		SurfaceBlr: strconv.FormatFloat(
			float64(settings.SurfaceBlur)*store.BackgroundBlurAtFull/100, 'f', -1, 64),
		User: user.Name,
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := s.shell.Execute(w, data); err != nil {
		s.log.Error("rendering index failed", "error", err)
	}
}

// location is the zone that decides what "today" is for a user: their own if
// they chose one, the server's otherwise. The store has already validated the
// name, so a failure here only means the zone database lost it since.
func (s *Server) location(settings store.Settings) *time.Location {
	if settings.TimeZone != "" {
		if loc, err := time.LoadLocation(settings.TimeZone); err == nil {
			return loc
		}
	}
	return s.cfg.Location
}

// todayFor is the current date in the user's zone. A failure to read the
// settings is logged and answered with the server's zone: an entry landing on
// the server's day is better than refusing to record it.
func (s *Server) todayFor(ctx context.Context, userID string) domain.Date {
	settings, err := s.store.GetSettings(ctx, userID)
	if err != nil {
		s.log.Error("loading settings failed", "error", err, "user", userID)
		return domain.Today(s.cfg.Location)
	}
	return domain.Today(s.location(settings))
}

// resolveLanguage turns the stored choice into the language the shell is
// rendered in. "system" takes the first language in Accept-Language that the
// interface is translated into; browsers list them in order of preference, so
// the q-values need not be read. English is the fallback, as the language the
// interface was written in.
func resolveLanguage(chosen, acceptLanguage string) string {
	if chosen != "system" && store.ValidLanguage(chosen) {
		return chosen
	}
	for _, part := range strings.Split(acceptLanguage, ",") {
		tag, _, _ := strings.Cut(strings.TrimSpace(part), ";")
		primary, _, _ := strings.Cut(strings.ToLower(tag), "-")
		if primary != "system" && store.ValidLanguage(primary) {
			return primary
		}
	}
	return "en"
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
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

func (s *Server) recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if errors.Is(asError(v), http.ErrAbortHandler) {
					panic(v)
				}
				s.log.Error("panic in handler",
					"value", v, "path", r.URL.Path, "stack", string(debug.Stack()))
				writeError(w, http.StatusInternalServerError, "Internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func asError(v any) error {
	if err, ok := v.(error); ok {
		return err
	}
	return nil
}

type statusRecorder struct {
	http.ResponseWriter
	status  int
	written bool
}

func (r *statusRecorder) WriteHeader(code int) {
	if !r.written {
		r.status, r.written = code, true
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	r.written = true
	return r.ResponseWriter.Write(b)
}

// newAssetHandler serves the embedded frontend with a content-derived ETag.
//
// Files in an embed.FS carry a zero modification time, so the file server sends
// no Last-Modified and the browser is free to cache them by heuristic. After an
// update that means an old app.js running against a new HTML shell — the worst
// kind of failure for a single binary that people upgrade by replacing the
// file. Hashing the content once at startup gives every asset a validator: the
// browser revalidates on each load and gets a 304 until the binary really
// changes. http.ServeContent honours If-None-Match against the ETag we set, so
// the conditional handling comes for free.
func newAssetHandler(webFS fs.FS) (http.Handler, error) {
	// Windows resolves media types through the registry, where a machine
	// without a web toolchain has no entry for .woff2 — the file server would
	// then fall back to sniffing and label the font a stream of bytes. Stating
	// it here makes the answer the same on every host.
	if err := mime.AddExtensionType(".woff2", "font/woff2"); err != nil {
		return nil, fmt.Errorf("registering mime type: %w", err)
	}
	// Same story for the manifest: no registry entry on Windows, and a browser
	// that is handed it as plain text ignores it.
	if err := mime.AddExtensionType(".webmanifest", "application/manifest+json"); err != nil {
		return nil, fmt.Errorf("registering mime type: %w", err)
	}

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
		// Only the files themselves. A directory would otherwise be answered
		// with a listing of its contents, which no page links to and nobody
		// needs to browse.
		tag, ok := etags[strings.TrimPrefix(path.Clean(r.URL.Path), "/")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("ETag", tag)
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	}), nil
}
