package worker

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
)

type checkpointClient interface {
	PublishCheckpoint(context.Context, string, int64, []map[string]any) error
}

type checkpointTask struct {
	sequence int64
	frames   []map[string]any
}

type checkpointWriter struct {
	ctx      context.Context
	client   checkpointClient
	logger   *slog.Logger
	interval time.Duration
	mu       sync.Mutex
	pending  map[string]checkpointTask
	failures atomic.Int64
	wg       sync.WaitGroup
}

func newCheckpointWriter(ctx context.Context, client checkpointClient, logger *slog.Logger, interval time.Duration) *checkpointWriter {
	if logger == nil {
		logger = slog.Default()
	}
	if interval <= 0 {
		interval = time.Second
	}
	writer := &checkpointWriter{ctx: ctx, client: client, logger: logger, interval: interval, pending: map[string]checkpointTask{}}
	writer.wg.Add(1)
	go writer.run()
	return writer
}

func (w *checkpointWriter) Submit(stream string, sequence int64, frames []map[string]any) {
	if stream == "" || sequence <= 0 || len(frames) == 0 || w.ctx.Err() != nil {
		return
	}
	copyFrames := make([]map[string]any, len(frames))
	copy(copyFrames, frames)
	w.mu.Lock()
	current, exists := w.pending[stream]
	if !exists || sequence >= current.sequence {
		w.pending[stream] = checkpointTask{sequence: sequence, frames: copyFrames}
	}
	w.mu.Unlock()
}

func (w *checkpointWriter) Pending() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.pending)
}

func (w *checkpointWriter) Failures() int64 { return w.failures.Load() }

func (w *checkpointWriter) Close() { w.wg.Wait() }

func (w *checkpointWriter) run() {
	defer w.wg.Done()
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	for {
		select {
		case <-w.ctx.Done():
			return
		case <-ticker.C:
			w.flush()
		}
	}
}

func (w *checkpointWriter) flush() {
	w.mu.Lock()
	tasks := make(map[string]checkpointTask, len(w.pending))
	for stream, task := range w.pending {
		tasks[stream] = task
	}
	w.mu.Unlock()

	for stream, task := range tasks {
		if w.ctx.Err() != nil {
			return
		}
		if err := w.client.PublishCheckpoint(w.ctx, stream, task.sequence, task.frames); err != nil {
			w.failures.Add(1)
			w.logger.Error("realtime_checkpoint_publish_failed", "stream", stream, "sequence", task.sequence, "error", err.Error())
			continue
		}
		w.mu.Lock()
		if current, exists := w.pending[stream]; exists && current.sequence <= task.sequence {
			delete(w.pending, stream)
		}
		w.mu.Unlock()
	}
}
