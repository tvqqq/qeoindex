package worker

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/realtime"
)

type fakeOrderbookPublishClient struct {
	broadcast  func(context.Context, string, string, any) error
	checkpoint func(context.Context, string, int64, []map[string]any) error
}

func (f *fakeOrderbookPublishClient) PublishPrivateBroadcast(ctx context.Context, topic, event string, payload any) error {
	if f.broadcast == nil {
		return nil
	}
	return f.broadcast(ctx, topic, event, payload)
}

func (f *fakeOrderbookPublishClient) PublishCheckpoint(ctx context.Context, stream string, sequence int64, frames []map[string]any) error {
	if f.checkpoint == nil {
		return nil
	}
	return f.checkpoint(ctx, stream, sequence, frames)
}

func testPublisherOptions() orderbookPublisherOptions {
	return orderbookPublisherOptions{
		BroadcastConcurrency: 4,
		CheckpointInterval:   5 * time.Millisecond,
		RetryDelay:           5 * time.Millisecond,
		QueueDepth:           1,
	}
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func testOrderbookBatch(symbol, tradeID string) realtime.OrderbookBatch {
	return realtime.OrderbookBatch{Frames: []realtime.Frame{{
		"T":          "te",
		"symbol":     symbol,
		"transId":    tradeID,
		"matchPrice": 67.1,
		"matchQtty":  10,
	}}}
}

func waitFor(t *testing.T, timeout time.Duration, condition func() bool, message string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal(message)
}

func TestOrderbookPublisherCheckpointCannotBlockAnotherShardBroadcast(t *testing.T) {
	checkpointStarted := make(chan struct{}, 1)
	checkpointRelease := make(chan struct{})
	broadcasts := make(chan int, 4)

	client := &fakeOrderbookPublishClient{
		broadcast: func(_ context.Context, _ string, _ string, payload any) error {
			envelope := payload.(orderbookEnvelope)
			broadcasts <- envelope.Shard
			return nil
		},
		checkpoint: func(ctx context.Context, _ string, _ int64, _ []map[string]any) error {
			select {
			case checkpointStarted <- struct{}{}:
			default:
			}
			select {
			case <-checkpointRelease:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		},
	}

	publisher := newOrderbookPublisher(context.Background(), client, testLogger(), []int64{0, 0}, testPublisherOptions())
	defer publisher.Close()

	if !publisher.Submit(0, testOrderbookBatch("MSN", "1")) {
		t.Fatal("expected first shard batch to be accepted")
	}
	select {
	case shard := <-broadcasts:
		if shard != 0 {
			t.Fatalf("first broadcast shard=%d want 0", shard)
		}
	case <-time.After(time.Second):
		t.Fatal("first broadcast did not start")
	}
	select {
	case <-checkpointStarted:
	case <-time.After(time.Second):
		t.Fatal("checkpoint did not start")
	}

	if !publisher.Submit(1, testOrderbookBatch("FPT", "2")) {
		t.Fatal("expected second shard batch to be accepted while checkpoint is blocked")
	}
	select {
	case shard := <-broadcasts:
		if shard != 1 {
			t.Fatalf("second broadcast shard=%d want 1", shard)
		}
	case <-time.After(250 * time.Millisecond):
		t.Fatal("blocked checkpoint delayed live broadcast on another shard")
	}
	close(checkpointRelease)
}

func TestOrderbookPublisherBroadcastsDifferentShardsConcurrently(t *testing.T) {
	var active int32
	var maxActive int32
	started := make(chan struct{}, 4)
	release := make(chan struct{})
	client := &fakeOrderbookPublishClient{
		broadcast: func(ctx context.Context, _ string, _ string, _ any) error {
			now := atomic.AddInt32(&active, 1)
			for {
				previous := atomic.LoadInt32(&maxActive)
				if now <= previous || atomic.CompareAndSwapInt32(&maxActive, previous, now) {
					break
				}
			}
			started <- struct{}{}
			select {
			case <-release:
				atomic.AddInt32(&active, -1)
				return nil
			case <-ctx.Done():
				atomic.AddInt32(&active, -1)
				return ctx.Err()
			}
		},
	}

	publisher := newOrderbookPublisher(context.Background(), client, testLogger(), []int64{0, 0}, testPublisherOptions())
	defer publisher.Close()
	if !publisher.Submit(0, testOrderbookBatch("MSN", "1")) || !publisher.Submit(1, testOrderbookBatch("FPT", "2")) {
		t.Fatal("expected both shard batches to be accepted")
	}

	for index := 0; index < 2; index++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("broadcasts did not overlap")
		}
	}
	if got := atomic.LoadInt32(&maxActive); got < 2 {
		t.Fatalf("expected concurrent shard broadcasts, max active=%d", got)
	}
	close(release)
}

func TestOrderbookPublisherRetriesFailedBroadcastWithoutAdvancingSequence(t *testing.T) {
	var mu sync.Mutex
	sequences := make([]int64, 0, 2)
	attempts := 0
	client := &fakeOrderbookPublishClient{
		broadcast: func(_ context.Context, _ string, _ string, payload any) error {
			envelope := payload.(orderbookEnvelope)
			mu.Lock()
			sequences = append(sequences, envelope.Sequence)
			attempts++
			attempt := attempts
			mu.Unlock()
			if attempt == 1 {
				return errors.New("temporary broadcast failure")
			}
			return nil
		},
	}

	publisher := newOrderbookPublisher(context.Background(), client, testLogger(), []int64{40}, testPublisherOptions())
	defer publisher.Close()
	if !publisher.Submit(0, testOrderbookBatch("MSN", "1")) {
		t.Fatal("expected batch to be accepted")
	}

	waitFor(t, time.Second, func() bool {
		return publisher.Sequences()[0] == 41
	}, "sequence did not advance after retry succeeded")

	mu.Lock()
	defer mu.Unlock()
	if len(sequences) < 2 {
		t.Fatalf("expected retry, attempts=%d", len(sequences))
	}
	if sequences[0] != 41 || sequences[1] != 41 {
		t.Fatalf("failed broadcast must retry the same sequence, got %v", sequences[:2])
	}
}
