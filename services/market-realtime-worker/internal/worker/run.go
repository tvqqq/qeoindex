package worker

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/config"
	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/dnse"
	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/dnseauth"
	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/realtime"
	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/supabase"
)

const maxRealtimePayloadBytes = 524288

func Run(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	_, windowEnd, active := cfg.Window(time.Now())
	if !active {
		logger.Info("market_window_closed", "timezone", config.MarketTimezone, "open", config.MarketOpen, "close", config.MarketClose)
		return nil
	}

	runCtx, cancel := context.WithDeadline(ctx, windowEnd)
	defer cancel()

	client := supabase.New(cfg.SupabaseURL, cfg.SupabaseServiceRoleKey)
	lastSequence, err := client.CurrentSequence(runCtx)
	if err != nil {
		return fmt.Errorf("load current market_realtime_bus sequence: %w", err)
	}
	tickers, err := client.Universe(runCtx)
	if err != nil {
		return fmt.Errorf("load canonical universe: %w", err)
	}

	logger.Info("market_realtime_worker_start", "tickers", len(tickers), "flush_ms", cfg.FlushInterval.Milliseconds(), "window_end", windowEnd.Format(time.RFC3339))
	buffer := realtime.NewBuffer(maxRealtimePayloadBytes)
	auth := dnseauth.New(cfg.DNSEAPIKey, cfg.DNSEAPISecret)
	onFrame := func(frame map[string]any) { buffer.Push(realtime.Frame(frame)) }

	var wg sync.WaitGroup
	startStream := func(streamCtx context.Context, stream *dnse.Stream) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := stream.Run(streamCtx); err != nil && streamCtx.Err() == nil {
				logger.Error("dnse_stream_stopped", "stream", stream.Name, "error", err.Error())
			}
		}()
	}

	indexStream := newStream("indexes", cfg, auth, dnse.IndexChannels(), onFrame, logger)
	startStream(runCtx, indexStream)

	stockCtx, stockCancel := context.WithCancel(runCtx)
	stockStream := newStream("ticks", cfg, auth, dnse.StockChannels(tickers), onFrame, logger)
	startStream(stockCtx, stockStream)

	flushTicker := time.NewTicker(cfg.FlushInterval)
	universeTicker := time.NewTicker(cfg.UniverseRefreshInterval)
	heartbeatTicker := time.NewTicker(30 * time.Second)
	defer flushTicker.Stop()
	defer universeTicker.Stop()
	defer heartbeatTicker.Stop()
	defer func() {
		stockCancel()
		cancel()
		wg.Wait()
	}()

	lastFlushFrames := 0
	for {
		select {
		case <-runCtx.Done():
			logger.Info("market_realtime_worker_stop", "reason", contextReason(runCtx), "last_sequence", lastSequence)
			return nil
		case <-flushTicker.C:
			frames := buffer.Drain()
			if len(frames) == 0 {
				continue
			}
			nextSequence := realtime.NextSequence(lastSequence, time.Now())
			plainFrames := make([]map[string]any, len(frames))
			for index, frame := range frames {
				plainFrames[index] = map[string]any(frame)
			}
			if err := client.Publish(runCtx, nextSequence, plainFrames); err != nil {
				buffer.Requeue(frames)
				logger.Error("realtime_bus_publish_failed", "error", err.Error(), "frames", len(frames))
				continue
			}
			lastSequence = nextSequence
			lastFlushFrames = len(frames)
		case <-universeTicker.C:
			next, err := client.Universe(runCtx)
			if err != nil {
				logger.Error("canonical_universe_refresh_failed", "error", err.Error())
				continue
			}
			if supabase.SameUniverse(tickers, next) {
				continue
			}
			stockCancel()
			tickers = next
			stockCtx, stockCancel = context.WithCancel(runCtx)
			stockStream = newStream("ticks", cfg, auth, dnse.StockChannels(tickers), onFrame, logger)
			startStream(stockCtx, stockStream)
			logger.Info("canonical_universe_subscription_refreshed", "tickers", len(tickers))
		case <-heartbeatTicker.C:
			logger.Info("market_realtime_worker_heartbeat", "sequence", lastSequence, "last_flush_frames", lastFlushFrames, "buffered_frames", buffer.Len(), "tickers", len(tickers))
		}
	}
}

func newStream(name string, cfg config.Config, auth dnseauth.Auth, channels []dnse.Channel, onFrame func(map[string]any), logger *slog.Logger) *dnse.Stream {
	return &dnse.Stream{
		Name: name, URL: cfg.DNSEWSURL, Auth: auth, Channels: channels, OnFrame: onFrame, Logger: logger,
		PingEvery: cfg.PingInterval, StaleAfter: cfg.StaleAfter, StaleActive: cfg.StaleWatchActive,
	}
}

func contextReason(ctx context.Context) string {
	if err := context.Cause(ctx); err != nil {
		return err.Error()
	}
	return "completed"
}
