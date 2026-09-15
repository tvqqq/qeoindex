package worker

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/config"
	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/dnse"
	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/dnseauth"
	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/realtime"
	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/relay"
	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/supabase"
)

const (
	maxRealtimePayloadBytes = 524288
	orderbookFanoutShards   = 10
)

var orderbookStreamNames = []string{"orderbook-0", "orderbook-1", "orderbook-2", "orderbook-3"}

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
	orderbookSequences := make([]int64, orderbookFanoutShards)
	hasPreviousOrderbookState := false
	for shard := 0; shard < orderbookFanoutShards; shard++ {
		sequence, err := client.CurrentSequenceFor(runCtx, orderbookCheckpointStream(shard))
		if err != nil {
			return fmt.Errorf("load orderbook shard %d checkpoint sequence: %w", shard, err)
		}
		orderbookSequences[shard] = sequence
		if sequence > 0 {
			hasPreviousOrderbookState = true
		}
	}

	tickers, err := client.Universe(runCtx)
	if err != nil {
		return fmt.Errorf("load canonical universe: %w", err)
	}
	orderbookPlan, err := PlanOrderbookShards(tickers)
	if err != nil {
		return fmt.Errorf("plan orderbook provider shards: %w", err)
	}
	epoch, err := newRelayEpoch()
	if err != nil {
		return fmt.Errorf("create realtime relay epoch: %w", err)
	}

	hub := relay.NewHub(epoch, cfg.RelaySendQueue, logger)
	hub.SetUniverse(tickers)
	relayServer := relay.NewServer(relay.ServerConfig{
		ListenAddr:     cfg.RelayListenAddr,
		SigningSecret:  cfg.RelaySigningSecret,
		AllowedOrigins: cfg.RelayAllowedOrigins,
		AuthTimeout:    cfg.RelayAuthTimeout,
		PingInterval:   cfg.RelayPingInterval,
	}, hub, logger)

	logger.Info(
		"market_realtime_worker_start",
		"tickers", len(tickers),
		"checkpoint_flush_ms", cfg.FlushInterval.Milliseconds(),
		"relay_market_flush_ms", cfg.RelayMarketFlushInterval.Milliseconds(),
		"relay_orderbook_flush_ms", cfg.RelayOrderbookFlushInterval.Milliseconds(),
		"provider_socket_target", 2+len(orderbookPlan),
		"window_end", windowEnd.Format(time.RFC3339),
	)

	checkpointBuffer := realtime.NewBuffer(maxRealtimePayloadBytes)
	marketRelayBuffer := realtime.NewBuffer(maxRealtimePayloadBytes)
	orderbookBuffer := realtime.NewOrderbookBuffer(orderbookFanoutShards, cfg.OrderbookMaxPayloadBytes, cfg.OrderbookMaxExecutionFrames)
	if hasPreviousOrderbookState {
		orderbookBuffer.MarkContinuityGapAll()
	}
	checkpointWriter := newCheckpointWriter(runCtx, client, logger, time.Second)
	auth := dnseauth.New(cfg.DNSEAPIKey, cfg.DNSEAPISecret)

	stampAndPushMarket := func(frame map[string]any) realtime.Frame {
		frame["_qeoWorkerReceivedAt"] = time.Now().UnixMilli()
		realtimeFrame := realtime.Frame(frame)
		checkpointBuffer.Push(realtimeFrame)
		marketRelayBuffer.Push(realtimeFrame)
		return realtimeFrame
	}
	onBoardFrame := func(frame map[string]any) {
		stampAndPushMarket(frame)
	}
	onTickFrame := func(frame map[string]any) {
		realtimeFrame := stampAndPushMarket(frame)
		orderbookBuffer.Push(realtimeFrame)
	}
	onOrderbookFrame := func(frame map[string]any) {
		frame["_qeoWorkerReceivedAt"] = time.Now().UnixMilli()
		orderbookBuffer.Push(realtime.Frame(frame))
	}

	var wg sync.WaitGroup
	relayErrCh := make(chan error, 1)
	wg.Add(1)
	go func() {
		defer wg.Done()
		relayErrCh <- relayServer.Run(runCtx)
	}()

	startStream := func(streamCtx context.Context, stream *dnse.Stream) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := stream.Run(streamCtx); err != nil && streamCtx.Err() == nil {
				logger.Error("dnse_stream_stopped", "stream", stream.Name, "error", err.Error())
			}
		}()
	}

	indexStream := newStream("indexes", cfg, auth, dnse.IndexChannels(), onBoardFrame, logger)
	startStream(runCtx, indexStream)

	startStockStream := func(symbols []string) context.CancelFunc {
		streamCtx, streamCancel := context.WithCancel(runCtx)
		stockStream := newStream("ticks", cfg, auth, dnse.StockChannels(symbols), onTickFrame, logger)
		stockStream.OnContinuityGap = orderbookBuffer.MarkContinuityGapAll
		startStream(streamCtx, stockStream)
		return streamCancel
	}
	stockCancel := startStockStream(tickers)

	orderbookCancels := map[int]context.CancelFunc{}
	startOrderbookShard := func(index int, symbols []string) context.CancelFunc {
		streamCtx, streamCancel := context.WithCancel(runCtx)
		stream := newStream(orderbookStreamNames[index], cfg, auth, dnse.OrderbookChannels(symbols), onOrderbookFrame, logger)
		stream.OnContinuityGap = orderbookBuffer.MarkContinuityGapAll
		logger.Info("orderbook_provider_shard_start", "stream", stream.Name, "symbols", len(symbols), "memberships", len(symbols)*4)
		startStream(streamCtx, stream)
		return streamCancel
	}
	for index, symbols := range orderbookPlan {
		orderbookCancels[index] = startOrderbookShard(index, symbols)
	}

	checkpointTicker := time.NewTicker(cfg.FlushInterval)
	marketRelayTicker := time.NewTicker(cfg.RelayMarketFlushInterval)
	orderbookRelayTicker := time.NewTicker(cfg.RelayOrderbookFlushInterval)
	universeTicker := time.NewTicker(cfg.UniverseRefreshInterval)
	heartbeatTicker := time.NewTicker(30 * time.Second)
	defer checkpointTicker.Stop()
	defer marketRelayTicker.Stop()
	defer orderbookRelayTicker.Stop()
	defer universeTicker.Stop()
	defer heartbeatTicker.Stop()
	defer func() {
		stockCancel()
		for _, shardCancel := range orderbookCancels {
			shardCancel()
		}
		cancel()
		checkpointWriter.Close()
		wg.Wait()
	}()

	marketRelaySequence := int64(0)
	orderbookRelaySequences := map[string]int64{}
	lastCheckpointFrames := 0
	lastMarketRelayFrames := 0
	lastOrderbookRelayFrames := 0

	for {
		select {
		case <-runCtx.Done():
			logger.Info("market_realtime_worker_stop", "reason", contextReason(runCtx), "last_checkpoint_sequence", lastSequence, "orderbook_checkpoint_sequences", orderbookSequences)
			return nil
		case relayErr := <-relayErrCh:
			if relayErr == nil {
				return fmt.Errorf("realtime relay server stopped unexpectedly")
			}
			return fmt.Errorf("realtime relay server failed: %w", relayErr)
		case <-marketRelayTicker.C:
			frames := marketRelayBuffer.Drain()
			if len(frames) == 0 {
				continue
			}
			marketRelaySequence++
			plainFrames := framesToMaps(frames)
			hub.Publish("market", relay.NewMarketMessage(epoch, marketRelaySequence, plainFrames))
			lastMarketRelayFrames = len(frames)
		case <-checkpointTicker.C:
			frames := checkpointBuffer.Drain()
			if len(frames) == 0 {
				continue
			}
			nextSequence := realtime.NextSequence(lastSequence, time.Now())
			checkpointWriter.Submit("dnse-market", nextSequence, framesToMaps(frames))
			lastSequence = nextSequence
			lastCheckpointFrames = len(frames)
		case <-orderbookRelayTicker.C:
			publishedFrames := 0
			for shard := 0; shard < orderbookFanoutShards; shard++ {
				batch := orderbookBuffer.DrainShard(shard)
				if len(batch.Frames) == 0 {
					continue
				}
				plainFrames := framesToMaps(batch.Frames)
				orderbookSequences[shard]++
				checkpointWriter.Submit(orderbookCheckpointStream(shard), orderbookSequences[shard], plainFrames)
				for symbol, symbolFrames := range groupOrderbookFrames(batch.Frames) {
					orderbookRelaySequences[symbol]++
					hub.Publish("orderbook:"+symbol, relay.NewOrderbookMessage(epoch, symbol, orderbookRelaySequences[symbol], batch.ContinuityGap, symbolFrames))
				}
				publishedFrames += len(batch.Frames)
			}
			if publishedFrames > 0 {
				lastOrderbookRelayFrames = publishedFrames
			}
		case <-universeTicker.C:
			next, err := client.Universe(runCtx)
			if err != nil {
				logger.Error("canonical_universe_refresh_failed", "error", err.Error())
				continue
			}
			if supabase.SameUniverse(tickers, next) {
				continue
			}
			nextOrderbookPlan, err := PlanOrderbookShards(next)
			if err != nil {
				logger.Error("orderbook_provider_plan_refresh_failed", "error", err.Error(), "tickers", len(next))
				continue
			}

			hub.SetUniverse(next)
			stockCancel()
			tickers = next
			stockCancel = startStockStream(tickers)

			maxShards := len(orderbookPlan)
			if len(nextOrderbookPlan) > maxShards {
				maxShards = len(nextOrderbookPlan)
			}
			planChanged := false
			for index := 0; index < maxShards; index++ {
				oldSymbols := orderbookShardAt(orderbookPlan, index)
				newSymbols := orderbookShardAt(nextOrderbookPlan, index)
				if sameStrings(oldSymbols, newSymbols) {
					continue
				}
				planChanged = true
				if shardCancel, exists := orderbookCancels[index]; exists {
					shardCancel()
					delete(orderbookCancels, index)
				}
				if len(newSymbols) > 0 {
					orderbookCancels[index] = startOrderbookShard(index, newSymbols)
				}
			}
			orderbookPlan = nextOrderbookPlan
			if planChanged {
				orderbookBuffer.MarkContinuityGapAll()
			}
			logger.Info("canonical_universe_subscription_refreshed", "tickers", len(tickers), "orderbook_provider_shards", len(orderbookPlan))
		case <-heartbeatTicker.C:
			memberships := make([]int, len(orderbookPlan))
			for index, symbols := range orderbookPlan {
				memberships[index] = len(symbols) * 4
			}
			relayStats := hub.Stats()
			logger.Info(
				"market_realtime_worker_heartbeat",
				"checkpoint_sequence", lastSequence,
				"last_checkpoint_frames", lastCheckpointFrames,
				"checkpoint_buffered_frames", checkpointBuffer.Len(),
				"checkpoint_pending_streams", checkpointWriter.Pending(),
				"checkpoint_failures", checkpointWriter.Failures(),
				"tickers", len(tickers),
				"provider_socket_target", 2+len(orderbookPlan),
				"orderbook_memberships", memberships,
				"orderbook_checkpoint_sequences", orderbookSequences,
				"orderbook_last_relay_frames", lastOrderbookRelayFrames,
				"orderbook_buffered_frames", orderbookBuffer.Len(),
				"orderbook_continuity_gaps", orderbookBuffer.GapCount(),
				"market_last_relay_frames", lastMarketRelayFrames,
				"relay_clients", relayStats.Clients,
				"relay_market_topics", relayStats.MarketTopics,
				"relay_orderbook_topics", relayStats.OrderbookTopics,
				"relay_slow_consumers", relayStats.SlowConsumers,
				"relay_published_batches", relayStats.Published,
				"relay_published_bytes", relayStats.PublishedBytes,
			)
		}
	}
}

func newStream(name string, cfg config.Config, auth dnseauth.Auth, channels []dnse.Channel, onFrame func(map[string]any), logger *slog.Logger) *dnse.Stream {
	return &dnse.Stream{
		Name: name, URL: cfg.DNSEWSURL, Auth: auth, Channels: channels, OnFrame: onFrame, Logger: logger,
		PingEvery: cfg.PingInterval, StaleAfter: cfg.StaleAfter, StaleActive: cfg.StaleWatchActive,
	}
}

func framesToMaps(frames []realtime.Frame) []map[string]any {
	plain := make([]map[string]any, len(frames))
	for index, frame := range frames {
		plain[index] = map[string]any(frame)
	}
	return plain
}

func groupOrderbookFrames(frames []realtime.Frame) map[string][]map[string]any {
	grouped := map[string][]map[string]any{}
	for _, frame := range frames {
		symbol, _ := frame["symbol"].(string)
		symbol = strings.ToUpper(strings.TrimSpace(symbol))
		if symbol == "" {
			continue
		}
		grouped[symbol] = append(grouped[symbol], map[string]any(frame))
	}
	return grouped
}

func newRelayEpoch() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func orderbookCheckpointStream(shard int) string {
	return fmt.Sprintf("orderbook-v1-%02d", shard)
}

func orderbookShardAt(plan [][]string, index int) []string {
	if index < 0 || index >= len(plan) {
		return nil
	}
	return plan[index]
}

func sameStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func contextReason(ctx context.Context) string {
	if err := context.Cause(ctx); err != nil {
		return err.Error()
	}
	return "completed"
}
