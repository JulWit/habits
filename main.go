// Command habits is a self-contained habit tracker: the HTTP server, the
// frontend and the SQLite driver all live in this one binary. The only file it
// needs at runtime is the database it creates itself.
package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	// Embeds the IANA timezone database (~450 KB) so HABITS_TZ works on hosts
	// without one of their own — Windows has no system zoneinfo at all, and a
	// scratch container usually has none either. A self-contained binary must
	// not depend on the host for this.
	_ "time/tzdata"

	"github.com/JulWit/habits/internal/config"
	"github.com/JulWit/habits/internal/httpapi"
	"github.com/JulWit/habits/internal/store"
)

//go:embed all:web
var webFiles embed.FS

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	// Also the package default, so the few helpers that are too small to carry
	// a logger — writing a response body, for one — still land in the same
	// stream as everything else instead of going quietly nowhere.
	slog.SetDefault(log)
	if err := run(log); err != nil {
		log.Error("startup failed", "error", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Strip the "web/" prefix so the handlers see index.html at the root.
	webFS, err := fs.Sub(webFiles, "web")
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(ctx, cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer st.Close()

	// Habits deleted longer ago than the retention window are past any
	// realistic undo, so their rows and entries go for good.
	if n, err := st.PurgeDeleted(ctx, cfg.DeletedRetention); err != nil {
		log.Warn("purging deleted habits failed", "error", err)
	} else if n > 0 {
		log.Info("permanently deleted habits removed", "count", n)
	}
	if n, err := st.PurgeDeletedCategories(ctx, cfg.DeletedRetention); err != nil {
		log.Warn("purging deleted categories failed", "error", err)
	} else if n > 0 {
		log.Info("permanently deleted categories removed", "count", n)
	}

	handler, err := httpapi.New(cfg, st, log, webFS)
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: handler,
		// Generous but finite: a stalled client must not hold a connection
		// open forever, and the single-connection SQLite pool makes slow
		// handlers everyone's problem.
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("habits started",
			"address", cfg.Addr,
			"database", cfg.DatabasePath,
			"auth", string(cfg.AuthMode),
			"timezone", cfg.Location.String())
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		log.Info("shutting down...")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
