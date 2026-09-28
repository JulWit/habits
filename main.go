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
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		if err := healthcheck(); err != nil {
			fmt.Fprintln(os.Stderr, "unhealthy:", err)
			os.Exit(1)
		}
		return
	}

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

	st, err := store.Open(ctx, cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer st.Close()

	// Deleted habits and categories are removed once their retention period
	// is over: now, and daily for a server that runs for long.
	purgeDeleted(ctx, st, cfg.DeletedRetention, log)
	go purgeDaily(ctx, st, cfg.DeletedRetention, log)

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

// purgeInterval is how often a running server removes expired deleted habits
// and categories.
const purgeInterval = 24 * time.Hour

// purgeDaily calls purgeDeleted every purgeInterval until ctx is done.
func purgeDaily(ctx context.Context, st *store.Store, retention time.Duration, log *slog.Logger) {
	ticker := time.NewTicker(purgeInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			purgeDeleted(ctx, st, retention, log)
		}
	}
}

// purgeDeleted permanently removes habits and categories deleted longer than
// retention ago. Failures are logged; the next run tries again.
func purgeDeleted(ctx context.Context, st *store.Store, retention time.Duration, log *slog.Logger) {
	if n, err := st.PurgeDeleted(ctx, retention); err != nil {
		log.Warn("purging deleted habits failed", "error", err)
	} else if n > 0 {
		log.Info("permanently deleted habits removed", "count", n)
	}
	if n, err := st.PurgeDeletedCategories(ctx, retention); err != nil {
		log.Warn("purging deleted categories failed", "error", err)
	} else if n > 0 {
		log.Info("permanently deleted categories removed", "count", n)
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
	url, err := healthcheckURL(cfg.Addr)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 5 * time.Second}
	res, err := client.Get(url)
	if err != nil {
		return err
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s answered %s", url, res.Status)
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
