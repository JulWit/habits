// Command habits is a habit tracker server. HTTP server, frontend and SQLite
// driver are compiled into a single binary.
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

	// Embedded time zone database for hosts without one (Windows, scratch
	// images).
	_ "time/tzdata"

	"github.com/JulWit/habits/internal/config"
	"github.com/JulWit/habits/internal/httpapi"
	"github.com/JulWit/habits/internal/store"
)

//go:embed all:web
var webFiles embed.FS

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	// Used by helpers that have no logger of their own.
	slog.SetDefault(log)
	if err := run(log); err != nil {
		log.Error("startup failed", "error", err)
		os.Exit(1)
	}
}

// run starts the server and blocks until it fails or receives a shutdown
// signal.
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

	for _, w := range cfg.Warnings {
		log.Warn(w)
	}

	st, err := store.Open(ctx, cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer st.Close()

	// Permanently remove habits and categories deleted before the retention
	// period.
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
		Addr:              cfg.Addr,
		Handler:           handler,
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
