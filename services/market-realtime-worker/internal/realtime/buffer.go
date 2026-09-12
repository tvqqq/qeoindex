package realtime

import (
	"encoding/json"
	"strings"
	"sync"
)

type Frame map[string]any

type Buffer struct {
	mu              sync.Mutex
	frames          map[string]Frame
	order           []string
	maxPayloadBytes int
}

func NewBuffer(maxPayloadBytes int) *Buffer {
	if maxPayloadBytes <= 0 {
		maxPayloadBytes = 524288
	}
	return &Buffer{frames: map[string]Frame{}, maxPayloadBytes: maxPayloadBytes}
}

func frameKey(frame Frame) (string, bool) {
	typ, _ := frame["T"].(string)
	symbol, _ := frame["symbol"].(string)
	if symbol == "" {
		symbol, _ = frame["indexName"].(string)
	}
	typ = strings.TrimSpace(typ)
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if (typ != "t" && typ != "mi") || symbol == "" {
		return "", false
	}
	return typ + ":" + symbol, true
}

func (b *Buffer) Push(frame Frame) {
	key, ok := frameKey(frame)
	if !ok {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, exists := b.frames[key]; !exists {
		b.order = append(b.order, key)
	}
	b.frames[key] = frame
}

func (b *Buffer) Drain() []Frame {
	b.mu.Lock()
	defer b.mu.Unlock()
	// The universe bounds the key-space, so payload sizing belongs on the ~1 Hz
	// publish path rather than every incoming market tick.
	b.trimLocked()
	out := b.snapshotLocked()
	b.frames = map[string]Frame{}
	b.order = nil
	return out
}

func (b *Buffer) Requeue(frames []Frame) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, frame := range frames {
		key, ok := frameKey(frame)
		if !ok {
			continue
		}
		if _, newerExists := b.frames[key]; newerExists {
			continue
		}
		b.frames[key] = frame
		b.order = append(b.order, key)
	}
}

func (b *Buffer) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.frames)
}

func (b *Buffer) snapshotLocked() []Frame {
	out := make([]Frame, 0, len(b.order))
	for _, key := range b.order {
		if frame, ok := b.frames[key]; ok {
			out = append(out, frame)
		}
	}
	return out
}

func (b *Buffer) trimLocked() {
	for len(b.order) > 0 {
		payload, err := json.Marshal(b.snapshotLocked())
		if err == nil && len(payload) <= b.maxPayloadBytes {
			return
		}
		oldest := b.order[0]
		b.order = b.order[1:]
		delete(b.frames, oldest)
	}
}
