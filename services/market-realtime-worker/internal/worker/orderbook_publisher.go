package worker

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/realtime"
)

const (
	maxOrderbookBroadcastConcurrency = 4
	orderbookCheckpointInterval       = time.Second
	orderbookBroadcastRetryDelay      = 100 * time.Millisecond
	orderbookPublisherQueueDepth      = 1
)

type orderbookEnvelope struct {
	Version       int              `json:"version"`
	Shard         int              `json:"shard"`
	Sequence      int64            `json:"sequence"`
	Epoch         int64            `json:"epoch"`
	ContinuityGap bool             `json:"continuityGap"`
	PublishedAt   string           `json:"publishedAt"`
	Frames        []map[string]any `json:"frames"`
}

type orderbookPublishClient interface {
	PublishPrivateBroadcast(context.Context, string, string, any) error
	PublishCheckpoint(context.Context, string, int64, []map[string]any) error
}

type orderbookPublisherOptions struct {
	BroadcastConcurrency int
	CheckpointInterval   time.Duration
	RetryDelay           time.Duration
	QueueDepth           int
}

type orderbookCheckpointTask struct {
	sequence int64
	frames   []map[string]any
}

type orderbookCheckpointSlot struct {
	mu     sync.Mutex
	latest *orderbookCheckpointTask
}

type orderbookPublisherStats struct {
	QueueDepth          int
	CheckpointPending   int
	BroadcastFailures   int64
	CheckpointFailures  int64
}

type orderbookPublisher struct {
	ctx             context.Context
	cancel          context.CancelFunc
	client          orderbookPublishClient
	logger          *slog.Logger
	options         orderbookPublisherOptions
	broadcastSlots  chan struct{}
	queues          []chan realtime.OrderbookBatch
	sequences       []atomic.Int64
	checkpoints     []orderbookCheckpointSlot
	broadcastErrors atomic.Int64
	checkpointErrors atomic.Int64
	wg              sync.WaitGroup
	closeOnce       sync.Once
}

func defaultOrderbookPublisherOptions() orderbookPublisherOptions {
	return orderbookPublisherOptions{
		BroadcastConcurrency: maxOrderbookBroadcastConcurrency,
		CheckpointInterval:   orderbookCheckpointInterval,
		RetryDelay:           orderbookBroadcastRetryDelay,
		QueueDepth:           orderbookPublisherQueueDepth,
	}
}

func newOrderbookPublisher(
	parent context.Context,
	client orderbookPublishClient,
	logger *slog.Logger,
	initialSequences []int64,
	options orderbookPublisherOptions,
) *orderbookPublisher {
	if options.BroadcastConcurrency <= 0 {
		options.BroadcastConcurrency = maxOrderbookBroadcastConcurrency
	}
	if options.CheckpointInterval <= 0 {
		options.CheckpointInterval = orderbookCheckpointInterval
	}
	if options.RetryDelay <= 0 {
		options.RetryDelay = orderbookBroadcastRetryDelay
	}
	if options.QueueDepth <= 0 {
		options.QueueDepth = orderbookPublisherQueueDepth
	}
	if logger == nil {
		logger = slog.Default()
	}

	ctx, cancel := context.WithCancel(parent)
	publisher := &orderbookPublisher{
		ctx:            ctx,
		cancel:         cancel,
		client:         client,
		logger:         logger,
		options:        options,
		broadcastSlots: make(chan struct{}, options.BroadcastConcurrency),
		queues:         make([]chan realtime.OrderbookBatch, len(initialSequences)),
		sequences:      make([]atomic.Int64, len(initialSequences)),
		checkpoints:    make([]orderbookCheckpointSlot, len(initialSequences)),
	}
	for shard, sequence := range initialSequences {
		publisher.sequences[shard].Store(sequence)
		publisher.queues[shard] = make(chan realtime.OrderbookBatch, options.QueueDepth)
		publisher.wg.Add(2)
		go publisher.runLiveShard(shard)
		go publisher.runCheckpointShard(shard)
	}
	return publisher
}

func (p *orderbookPublisher) Submit(shard int, batch realtime.OrderbookBatch) bool {
	if shard < 0 || shard >= len(p.queues) || len(batch.Frames) == 0 {
		return false
	}
	select {
	case <-p.ctx.Done():
		return false
	case p.queues[shard] <- batch:
		return true
	default:
		return false
	}
}

func (p *orderbookPublisher) Sequences() []int64 {
	sequences := make([]int64, len(p.sequences))
	for shard := range p.sequences {
		sequences[shard] = p.sequences[shard].Load()
	}
	return sequences
}

func (p *orderbookPublisher) Stats() orderbookPublisherStats {
	stats := orderbookPublisherStats{
		BroadcastFailures:  p.broadcastErrors.Load(),
		CheckpointFailures: p.checkpointErrors.Load(),
	}
	for shard := range p.queues {
		stats.QueueDepth += len(p.queues[shard])
		p.checkpoints[shard].mu.Lock()
		if p.checkpoints[shard].latest != nil {
			stats.CheckpointPending++
		}
		p.checkpoints[shard].mu.Unlock()
	}
	return stats
}

func (p *orderbookPublisher) Close() {
	p.closeOnce.Do(func() {
		p.cancel()
		p.wg.Wait()
	})
}

func (p *orderbookPublisher) runLiveShard(shard int) {
	defer p.wg.Done()
	for {
		select {
		case <-p.ctx.Done():
			return
		case batch := <-p.queues[shard]:
			p.publishLiveBatch(shard, batch)
		}
	}
}

func (p *orderbookPublisher) publishLiveBatch(shard int, batch realtime.OrderbookBatch) {
	sequence := p.sequences[shard].Load() + 1
	frames := framesToMaps(batch.Frames)
	for {
		if p.ctx.Err() != nil {
			return
		}
		select {
		case p.broadcastSlots <- struct{}{}:
		case <-p.ctx.Done():
			return
		}

		envelope := orderbookEnvelope{
			Version:       1,
			Shard:         shard,
			Sequence:      sequence,
			Epoch:         batch.Epoch,
			ContinuityGap: batch.ContinuityGap,
			PublishedAt:   time.Now().UTC().Format(time.RFC3339Nano),
			Frames:        frames,
		}
		err := p.client.PublishPrivateBroadcast(p.ctx, orderbookBroadcastTopic(shard), "orderbook", envelope)
		<-p.broadcastSlots
		if err == nil {
			p.sequences[shard].Store(sequence)
			p.setCheckpoint(shard, orderbookCheckpointTask{sequence: sequence, frames: frames})
			return
		}

		p.broadcastErrors.Add(1)
		p.logger.Error(
			"orderbook_broadcast_publish_failed",
			"shard", shard,
			"sequence", sequence,
			"frames", len(batch.Frames),
			"error", err.Error(),
		)
		if !sleepContext(p.ctx, p.options.RetryDelay) {
			return
		}
	}
}

func (p *orderbookPublisher) setCheckpoint(shard int, task orderbookCheckpointTask) {
	slot := &p.checkpoints[shard]
	slot.mu.Lock()
	defer slot.mu.Unlock()
	if slot.latest != nil && slot.latest.sequence > task.sequence {
		return
	}
	copyTask := task
	slot.latest = &copyTask
}

func (p *orderbookPublisher) runCheckpointShard(shard int) {
	defer p.wg.Done()
	ticker := time.NewTicker(p.options.CheckpointInterval)
	defer ticker.Stop()
	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
			p.flushCheckpoint(shard)
		}
	}
}

func (p *orderbookPublisher) flushCheckpoint(shard int) {
	slot := &p.checkpoints[shard]
	slot.mu.Lock()
	if slot.latest == nil {
		slot.mu.Unlock()
		return
	}
	task := *slot.latest
	slot.mu.Unlock()

	if err := p.client.PublishCheckpoint(p.ctx, orderbookCheckpointStream(shard), task.sequence, task.frames); err != nil {
		if p.ctx.Err() != nil {
			return
		}
		p.checkpointErrors.Add(1)
		p.logger.Error(
			"orderbook_checkpoint_publish_failed",
			"shard", shard,
			"sequence", task.sequence,
			"error", err.Error(),
		)
		return
	}

	slot.mu.Lock()
	if slot.latest != nil && slot.latest.sequence <= task.sequence {
		slot.latest = nil
	}
	slot.mu.Unlock()
}

func orderbookCheckpointStream(shard int) string {
	return fmt.Sprintf("orderbook-v1-%02d", shard)
}

func orderbookBroadcastTopic(shard int) string {
	return fmt.Sprintf("orderbook:v1:%02d", shard)
}

func sleepContext(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
}
