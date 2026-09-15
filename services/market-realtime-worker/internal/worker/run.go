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

const (
	maxRealtimePayloadBytes = 524288
	orderbookFanoutShards   = 10
)

var orderbookStreamNames = []string{"orderbook-0", "orderbook-1", "orderbook-2", "orderbook-3"}

type orderbookEnvelope struct {
	Version       int              `json:"version"`
	Shard         int              `json:"shard"`
	Sequence      int64            `json:"sequence"`
	Epoch         int64            `json:"epoch"`
	ContinuityGap bool             `json:"continuityGap"`
	PublishedAt   string           `json:"publishedAt"`
	Frames        []map[string]any `json:"frames"`
}

type pendingOrderbookPublish struct {
	sequence    int64
	batch       realtime.OrderbookBatch
	envelope    orderbookEnvelope
	broadcasted bool
}

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

	logger.Info(
		"market_realtime_worker_start",
		"tickers", len(tickers),
		"flush_ms", cfg.FlushInterval.Milliseconds(),
		"orderbook_flush_ms", cfg.OrderbookFlushInterval.Milliseconds(),
		"provider_socket_target", 2+len(orderbookPlan),
		"window_end", windowEnd.Format(time.RFC3339),
	)
	buffer := realtime.NewBuffer(maxRealtimePayloadBytes)
	orderbookBuffer := realtime.NewOrderbookBuffer(orderbookFanoutShards, cfg.OrderbookMaxPayloadBytes, cfg.OrderbookMaxExecutionFrames)
	if hasPreviousOrderbookState {
		// A worker restart can hide provider frames between processes. Force the
		// next shard payload to trigger authoritative browser recovery.
		orderbookBuffer.MarkContinuityGapAll()
	}
	auth := dnseauth.New(cfg.DNSEAPIKey, cfg.DNSEAPISecret)
	onBoardFrame := func(frame map[string]any) { buffer.Push(realtime.Frame(frame)) }
	onTickFrame := func(frame map[string]any) {
		buffer.Push(realtime.Frame(frame))
		orderbookBuffer.Push(realtime.Frame(frame))
	}
	onOrderbookFrame := func(frame map[string]any) { orderbookBuffer.Push(realtime.Frame(frame)) }

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

	flushTicker := time.NewTicker(cfg.FlushInterval)
	orderbookFlushTicker := time.NewTicker(cfg.OrderbookFlushInterval)
	universeTicker := time.NewTicker(cfg.UniverseRefreshInterval)
	heartbeatTicker := time.NewTicker(30 * time.Second)
	defer flushTicker.Stop()
	defer orderbookFlushTicker.Stop()
	defer universeTicker.Stop()
	defer heartbeatTicker.Stop()
	defer func() {
		stockCancel()
		for _, shardCancel := range orderbookCancels {
			shardCancel()
		}
		cancel()
		wg.Wait()
	}()

	pendingOrderbook := make([]*pendingOrderbookPublish, orderbookFanoutShards)
	lastFlushFrames := 0
	lastOrderbookFlushFrames := 0

	for {
		select {
		case <-runCtx.Done():
			logger.Info("market_realtime_worker_stop", "reason", contextReason(runCtx), "last_sequence", lastSequence, "orderbook_sequences", orderbookSequences)
			return nil
		case <-flushTicker.C:
			frames := buffer.Drain()
			if len(frames) == 0 {
				continue
			}
			nextSequence := realtime.NextSequence(lastSequence, time.Now())
			plainFrames := framesToMaps(frames)
			if err := client.Publish(runCtx, nextSequence, plainFrames); err != nil {
				buffer.Requeue(frames)
				logger.Error("realtime_bus_publish_failed", "error", err.Error(), "frames", len(frames))
				continue
			}
			lastSequence = nextSequence
			lastFlushFrames = len(frames)
		case <-orderbookFlushTicker.C:
			publishedFrames := 0
			for shard := 0; shard < orderbookFanoutShards; shard++ {
				pending := pendingOrderbook[shard]
				if pending == nil {
					batch := orderbookBuffer.DrainShard(shard)
					if len(batch.Frames) == 0 {
						continue
					}
					plainFrames := framesToMaps(batch.Frames)
					sequence := orderbookSequences[shard] + 1
					pending = &pendingOrderbookPublish{
						sequence: sequence,
						batch:    batch,
						envelope: orderbookEnvelope{
							Version:       1,
							Shard:         shard,
							Sequence:      sequence,
							Epoch:         batch.Epoch,
							ContinuityGap: batch.ContinuityGap,
							PublishedAt:   time.Now().UTC().Format(time.RFC3339Nano),
							Frames:        plainFrames,
						},
					}
					pendingOrderbook[shard] = pending
				}

				if !pending.broadcasted {
					if err := client.PublishPrivateBroadcast(runCtx, orderbookBroadcastTopic(shard), "orderbook", pending.envelope); err != nil {
						logger.Error("orderbook_broadcast_publish_failed", "shard", shard, "sequence", pending.sequence, "frames", len(pending.batch.Frames), "error", err.Error())
						continue
					}
					pending.broadcasted = true
				}

				if err := client.PublishCheckpoint(runCtx, orderbookCheckpointStream(shard), pending.sequence, pending.envelope.Frames); err != nil {
					logger.Error("orderbook_checkpoint_publish_failed", "shard", shard, "sequence", pending.sequence, "error", err.Error())
					continue
				}
				orderbookSequences[shard] = pending.sequence
				publishedFrames += len(pending.batch.Frames)
				pendingOrderbook[shard] = nil
			}
			if publishedFrames > 0 {
				lastOrderbookFlushFrames = publishedFrames
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
				// Supplemental reconnects can miss execution events. Make the loss
				// explicit so browser clients recover from the session authority.
				orderbookBuffer.MarkContinuityGapAll()
			}
			logger.Info("canonical_universe_subscription_refreshed", "tickers", len(tickers), "orderbook_provider_shards", len(orderbookPlan))
		case <-heartbeatTicker.C:
			pendingCount := 0
			for _, pending := range pendingOrderbook {
				if pending != nil {
					pendingCount++
				}
			}
			memberships := make([]int, len(orderbookPlan))
			for index, symbols := range orderbookPlan {
				memberships[index] = len(symbols) * 4
			}
			logger.Info(
				"market_realtime_worker_heartbeat",
				"sequence", lastSequence,
				"last_flush_frames", lastFlushFrames,
				"buffered_frames", buffer.Len(),
				"tickers", len(tickers),
				"provider_socket_target", 2+len(orderbookPlan),
				"orderbook_memberships", memberships,
				"orderbook_sequences", orderbookSequences,
				"orderbook_last_flush_frames", lastOrderbookFlushFrames,
				"orderbook_buffered_frames", orderbookBuffer.Len(),
				"orderbook_pending_shards", pendingCount,
				"orderbook_continuity_gaps", orderbookBuffer.GapCount(),
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

func orderbookCheckpointStream(shard int) string {
	return fmt.Sprintf("orderbook-v1-%02d", shard)
}

func orderbookBroadcastTopic(shard int) string {
	return fmt.Sprintf("orderbook:v1:%02d", shard)
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
