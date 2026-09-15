package worker

import (
	"context"
	"sync"
	"testing"
	"time"
)

type fakeCheckpointClient struct {
	mu      sync.Mutex
	streams []string
	block   <-chan struct{}
}

func (f *fakeCheckpointClient) PublishCheckpoint(ctx context.Context, stream string, _ int64, _ []map[string]any) error {
	if f.block != nil {
		select {
		case <-f.block:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	f.mu.Lock()
	f.streams = append(f.streams, stream)
	f.mu.Unlock()
	return nil
}

func TestCheckpointSubmitNeverWaitsForNetwork(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	blocked := make(chan struct{})
	client := &fakeCheckpointClient{block: blocked}
	writer := newCheckpointWriter(ctx, client, nil, time.Millisecond)

	start := time.Now()
	writer.Submit("dnse-market", 1, []map[string]any{{"T": "t"}})
	time.Sleep(5 * time.Millisecond)
	writer.Submit("dnse-market", 2, []map[string]any{{"T": "t"}})
	if elapsed := time.Since(start); elapsed > 50*time.Millisecond {
		t.Fatalf("Submit blocked on checkpoint network work: %v", elapsed)
	}

	close(blocked)
	time.Sleep(10 * time.Millisecond)
	cancel()
	writer.Close()
}

func TestCheckpointSubmitCoalescesNewestSequence(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	client := &fakeCheckpointClient{}
	writer := newCheckpointWriter(ctx, client, nil, time.Hour)
	writer.Submit("stream", 1, []map[string]any{{"n": 1}})
	writer.Submit("stream", 3, []map[string]any{{"n": 3}})
	writer.Submit("stream", 2, []map[string]any{{"n": 2}})

	writer.mu.Lock()
	task := writer.pending["stream"]
	writer.mu.Unlock()
	if task.sequence != 3 {
		t.Fatalf("pending sequence = %d, want 3", task.sequence)
	}
	cancel()
	writer.Close()
}
