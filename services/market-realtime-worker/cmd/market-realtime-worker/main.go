package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	_ "time/tzdata"

	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/config"
	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/worker"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("configuration_invalid", "error", err.Error())
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := worker.Run(ctx, cfg, logger); err != nil {
		logger.Error("market_realtime_worker_failed", "error", err.Error())
		os.Exit(1)
	}
}
