package realtime

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"
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
	if (typ != "t" && typ != "mi" && typ != "f" && typ != "index-impact") || symbol == "" {
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
	} else if providerFrameIsOlder(frame, b.frames[key]) {
		return
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
		current, exists := b.frames[key]
		if exists {
			if !providerOrderedFrame(frame) {
				continue
			}
			currentTime, currentOK := providerFrameTime(current)
			requeuedTime, requeuedOK := providerFrameTime(frame)
			// The frame being requeued was drained before current arrived. Keep
			// current on equal timestamps because it may be an equal-time correction.
			if currentOK && (!requeuedOK || !requeuedTime.After(currentTime)) {
				continue
			}
		} else {
			b.order = append(b.order, key)
		}
		b.frames[key] = frame
	}
}

func providerOrderedFrame(frame Frame) bool {
	typ, _ := frame["T"].(string)
	switch strings.TrimSpace(typ) {
	case "mi", "f", "index-impact":
		return true
	default:
		return false
	}
}

func providerFrameIsOlder(candidate, current Frame) bool {
	if !providerOrderedFrame(candidate) {
		return false
	}
	candidateTime, candidateOK := providerFrameTime(candidate)
	currentTime, currentOK := providerFrameTime(current)
	if !currentOK {
		return false
	}
	if !candidateOK {
		return true
	}
	return candidateTime.Before(currentTime)
}

func providerFrameTime(frame Frame) (time.Time, bool) {
	typ, _ := frame["T"].(string)
	switch strings.TrimSpace(typ) {
	case "mi":
		return parseProviderFrameTime(frame["transactTime"])
	case "f":
		return parseProviderFrameTime(frame["multicastReceiveTime"])
	case "index-impact":
		value, _ := frame["providerAsOf"].(string)
		parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(value))
		return parsed, err == nil
	default:
		return time.Time{}, false
	}
}

func parseProviderFrameTime(value any) (time.Time, bool) {
	if text, ok := value.(string); ok {
		parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(text))
		return parsed, err == nil
	}
	if fields, ok := value.(map[string]any); ok {
		seconds, secondsOK := timestampInteger(fields["seconds"])
		if !secondsOK {
			seconds, secondsOK = timestampInteger(fields["Seconds"])
		}
		if !secondsOK || seconds <= 0 {
			return time.Time{}, false
		}
		nanos := int64(0)
		if rawNanos, exists := fields["nanos"]; exists && rawNanos != nil {
			parsed, valid := timestampInteger(rawNanos)
			if !valid {
				return time.Time{}, false
			}
			nanos = parsed
		} else if rawNanos, exists := fields["Nanos"]; exists && rawNanos != nil {
			parsed, valid := timestampInteger(rawNanos)
			if !valid {
				return time.Time{}, false
			}
			nanos = parsed
		}
		if nanos < 0 || nanos >= int64(time.Second) {
			return time.Time{}, false
		}
		return time.Unix(seconds, nanos).UTC(), true
	}
	valueNumber, ok := timestampNumber(value)
	if !ok || valueNumber <= 0 {
		return time.Time{}, false
	}
	if valueNumber > 10_000_000_000 {
		return time.UnixMilli(int64(valueNumber)).UTC(), true
	}
	seconds := math.Floor(valueNumber)
	nanos := int64((valueNumber - seconds) * float64(time.Second))
	return time.Unix(int64(seconds), nanos).UTC(), true
}

func timestampInteger(value any) (int64, bool) {
	switch typed := value.(type) {
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err == nil
	case float64:
		const maxSafeInteger = float64(1<<53 - 1)
		if math.IsNaN(typed) || math.IsInf(typed, 0) || math.Trunc(typed) != typed || typed < -maxSafeInteger || typed > maxSafeInteger {
			return 0, false
		}
		return int64(typed), true
	case float32:
		number := float64(typed)
		if math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number {
			return 0, false
		}
		return int64(number), true
	case int:
		return int64(typed), true
	case int32:
		return int64(typed), true
	case int64:
		return typed, true
	case uint:
		const maxInt64 = uint64(1<<63 - 1)
		if uint64(typed) > maxInt64 {
			return 0, false
		}
		return int64(typed), true
	case uint32:
		return int64(typed), true
	case uint64:
		const maxInt64 = uint64(1<<63 - 1)
		if typed > maxInt64 {
			return 0, false
		}
		return int64(typed), true
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func timestampNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil && !math.IsNaN(number) && !math.IsInf(number, 0)
	case float64:
		return typed, !math.IsNaN(typed) && !math.IsInf(typed, 0)
	case float32:
		number := float64(typed)
		return number, !math.IsNaN(number) && !math.IsInf(number, 0)
	case int:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case uint:
		return float64(typed), true
	case uint32:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	case string:
		number, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return number, err == nil && !math.IsNaN(number) && !math.IsInf(number, 0)
	default:
		return 0, false
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
