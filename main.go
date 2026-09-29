// Command habits is a habit tracker server. HTTP server, frontend and SQLite
// driver are compiled into a single binary.
package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	// Embedded time zone database for hosts without one (Windows, scratch
	// images).
	_ "time/tzdata"

	"github.com/JulWit/habits/internal/config"
	"github.com/JulWit/habits/internal/httpapi"
	"github.com/JulWit/habits/internal/store"

	// SQLite driver for the store, in pure Go so that no cgo is needed.
	_ "modernc.org/sqlite"
)

//go:embed all:web
var webFiles embed.FS

func main() {
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		if err := healthcheck(); err != nil {
			fmt.Fprintln(os.Stderr, "unhealthy:", err)
			os.Exit(1)
		}
		return
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	// Used by helpers that have no logger of their own.
	slog.SetDefault(logger)
	if err := run(logger); err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}
}

// run starts the server and blocks until it fails or receives a shutdown
// signal.
func run(logger *slog.Logger) error {
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

	// Undo steps are removed once their retention period is over: now, and
	// daily for a server that runs for long. The daily purge ends before the
	// store closes (deferred calls run in reverse order).
	purgeSteps(ctx, st, cfg.UndoRetention, logger)
	purgeCtx, stopPurging := context.WithCancel(ctx)
	var purging sync.WaitGroup
	purging.Go(func() { purgeDaily(purgeCtx, st, cfg.UndoRetention, logger) })
	defer func() {
		stopPurging()
		purging.Wait()
	}()

	handler, err := httpapi.New(cfg, st, logger, webFS)
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
		logger.Info("habits started",
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
		logger.Info("shutting down...")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// purgeInterval is how often a running server removes expired undo steps.
const purgeInterval = 24 * time.Hour

// purgeDaily calls purgeSteps every purgeInterval until ctx is done.
func purgeDaily(ctx context.Context, st *store.Store, retention time.Duration, logger *slog.Logger) {
	ticker := time.NewTicker(purgeInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			purgeSteps(ctx, st, retention, logger)
		}
	}
}

// purgeSteps removes the undo steps older than retention. Failures are
// logged; the next run tries again.
func purgeSteps(ctx context.Context, st *store.Store, retention time.Duration, logger *slog.Logger) {
	if n, err := st.PurgeSteps(ctx, retention); err != nil {
		logger.Warn("purging undo steps failed", "error", err)
	} else if n > 0 {
		logger.Info("expired undo steps removed", "count", n)
	}
}

// healthcheck asks the server running with the same configuration for
// /healthz. It is the container's HEALTHCHECK, as the image has no shell and
// no curl.
func healthcheck() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	healthURL, err := healthcheckURL(cfg.Addr)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 5 * time.Second}
	res, err := client.Get(healthURL)
	if err != nil {
		return err
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s answered %s", healthURL, res.Status)
	}
	return nil
}

// healthcheckURL returns the URL of /healthz for a server listening on addr.
// A server listening on all interfaces is asked on the loopback interface.
func healthcheckURL(addr string) (string, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "", fmt.Errorf("HABITS_ADDR: %w", err)
	}
	switch host {
	case "", "0.0.0.0":
		host = "127.0.0.1"
	case "::":
		host = "::1"
	}
	return "http://" + net.JoinHostPort(host, port) + "/healthz", nil
}
