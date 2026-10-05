package worker

import (
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/realtime"
)

const (
	maxContextSnapshotSymbols = 200
	maxContextSnapshotFrames  = maxContextSnapshotSymbols + 1
	maxContextSnapshotBytes   = 256 * 1024
)

type contextSnapshotBuffer struct {
	mu          sync.Mutex
	sessionDate string
	universe    map[string]struct{}
	frames      map[string]realtime.Frame
	frameBytes  map[string]int
	order       []string
	maxBytes    int
	currentSize int
}

func newContextSnapshotBuffer(sessionDate string, maxBytes int) *contextSnapshotBuffer {
	if maxBytes <= 0 {
		maxBytes = maxContextSnapshotBytes
	}
	return &contextSnapshotBuffer{
		sessionDate: sessionDate,
		universe:    map[string]struct{}{},
		frames:      map[string]realtime.Frame{},
		frameBytes:  map[string]int{},
		maxBytes:    maxBytes,
	}
}

func (b *contextSnapshotBuffer) SetUniverse(symbols []string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(symbols) > maxContextSnapshotSymbols {
		b.universe = map[string]struct{}{}
	} else {
		b.universe = make(map[string]struct{}, len(symbols))
		for _, symbol := range symbols {
			normalized := strings.ToUpper(strings.TrimSpace(symbol))
			if normalized != "" {
				b.universe[normalized] = struct{}{}
			}
		}
	}
	b.pruneLocked()
}

func (b *contextSnapshotBuffer) Push(frame realtime.Frame) bool {
	typ, _ := frame["T"].(string)
	typ = strings.TrimSpace(typ)
	symbol, _ := frame["symbol"].(string)
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.acceptsLocked(frame, typ, symbol) || (typ == "f" && !hasForeignSnapshotAmounts(frame)) {
		return false
	}
	key := typ + ":" + symbol
	if previous, exists := b.frames[key]; exists {
		previousTime, previousOK := contextFrameSourceTime(previous, typ)
		nextTime, nextOK := contextFrameSourceTime(frame, typ)
		if previousOK && nextOK && nextTime.Before(previousTime) {
			return true
		}
	}
	if _, exists := b.frames[key]; !exists && len(b.frames) >= maxContextSnapshotFrames {
		return false
	}

	copyFrame := cloneRealtimeFrame(frame)
	encoded, err := json.Marshal(copyFrame)
	if err != nil || len(encoded)+2 > b.maxBytes {
		return false
	}
	oldBytes := b.frameBytes[key]
	projectedSize := b.currentSize - oldBytes + len(encoded)
	if len(b.frames) == 0 {
		projectedSize += 2
	} else if oldBytes == 0 {
		projectedSize += 1
	}
	if projectedSize > b.maxBytes {
		return false
	}
	if oldBytes == 0 {
		b.order = append(b.order, key)
	}
	b.frames[key] = copyFrame
	b.frameBytes[key] = len(encoded)
	b.currentSize = projectedSize
	return true
}

func (b *contextSnapshotBuffer) Accepts(frame realtime.Frame) bool {
	typ, _ := frame["T"].(string)
	symbol, _ := frame["symbol"].(string)
	b.mu.Lock()
	defer b.mu.Unlock()
	typ = strings.TrimSpace(typ)
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if !b.acceptsLocked(frame, typ, symbol) {
		return false
	}
	nextTime, ok := contextFrameSourceTime(frame, typ)
	if !ok || nextTime.After(time.Now().Add(5*time.Second)) {
		return false
	}
	if previous, exists := b.frames[typ+":"+symbol]; exists {
		previousTime, previousOK := contextFrameSourceTime(previous, typ)
		if previousOK && nextTime.Before(previousTime) {
			return false
		}
	}
	return true
}

func (b *contextSnapshotBuffer) acceptsLocked(frame realtime.Frame, typ, symbol string) bool {
	if symbol == "" || (typ != "f" && typ != "index-impact") {
		return false
	}
	providerDate, ok := contextFrameSessionDate(frame, typ)
	if !ok || providerDate != b.sessionDate {
		return false
	}
	providerTime, ok := contextFrameSourceTime(frame, typ)
	if !ok || providerTime.After(time.Now().Add(5*time.Second)) {
		return false
	}
	if typ == "f" {
		_, exists := b.universe[symbol]
		return exists
	}
	return symbol == "VNINDEX"
}

func hasForeignSnapshotAmounts(frame realtime.Frame) bool {
	_, hasBuy := firstFiniteFrameValue(frame, "totalBuyTradedAmount", "buyTradedAmount")
	_, hasSell := firstFiniteFrameValue(frame, "totalSellTradedAmount", "sellTradedAmount")
	return hasBuy && hasSell
}

func firstFiniteFrameValue(frame realtime.Frame, keys ...string) (float64, bool) {
	for _, key := range keys {
		value, exists := frame[key]
		if !exists || value == nil {
			continue
		}
		parsed, ok := impactNumber(value)
		if ok && parsed >= 0 {
			return parsed, true
		}
		return 0, false
	}
	return 0, false
}

func (b *contextSnapshotBuffer) Snapshot() []realtime.Frame {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]realtime.Frame, 0, len(b.frames))
	for _, key := range b.order {
		if frame, ok := b.frames[key]; ok {
			out = append(out, cloneRealtimeFrame(frame))
		}
	}
	return out
}

func (b *contextSnapshotBuffer) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.frames)
}

func (b *contextSnapshotBuffer) pruneLocked() {
	for key, frame := range b.frames {
		typ, _ := frame["T"].(string)
		symbol, _ := frame["symbol"].(string)
		if typ == "f" {
			if _, exists := b.universe[symbol]; exists {
				continue
			}
			b.removeLocked(key)
		}
	}
	if len(b.order) == len(b.frames) {
		return
	}
	kept := make([]string, 0, len(b.frames))
	for _, key := range b.order {
		if _, exists := b.frames[key]; exists {
			kept = append(kept, key)
		}
	}
	b.order = kept
}

func (b *contextSnapshotBuffer) removeLocked(key string) {
	b.currentSize -= b.frameBytes[key]
	delete(b.frameBytes, key)
	delete(b.frames, key)
	if len(b.frames) == 0 {
		b.currentSize = 0
	} else {
		b.currentSize-- // Remove the comma which separated this frame.
	}
}

func contextFrameSessionDate(frame realtime.Frame, typ string) (string, bool) {
	sourceTime, ok := contextFrameSourceTime(frame, typ)
	if !ok {
		return "", false
	}
	return vietnamDateKey(sourceTime), true
}

func contextFrameSourceTime(frame realtime.Frame, typ string) (time.Time, bool) {
	var sourceTime time.Time
	if typ == "f" {
		providerTime, ok := parseProviderImpactTime(frame["multicastReceiveTime"])
		if !ok {
			return time.Time{}, false
		}
		var valid bool
		sourceTime, valid = providerTime.asOf()
		if !valid {
			return time.Time{}, false
		}
	} else {
		asOf, _ := frame["providerAsOf"].(string)
		parsed, err := time.Parse(time.RFC3339Nano, asOf)
		if err != nil {
			return time.Time{}, false
		}
		sourceTime = parsed
	}
	return sourceTime, true
}

func vietnamDateKey(value time.Time) string {
	return value.In(marketTimezone()).Format("2006-01-02")
}

func marketTimezone() *time.Location {
	location, err := time.LoadLocation("Asia/Ho_Chi_Minh")
	if err != nil {
		return time.FixedZone("ICT", 7*60*60)
	}
	return location
}

func cloneRealtimeFrame(frame realtime.Frame) realtime.Frame {
	copyFrame := make(realtime.Frame, len(frame))
	for key, value := range frame {
		copyFrame[key] = value
	}
	return copyFrame
}

func combineCheckpointFrames(current, retained []realtime.Frame, maxBytes int) []realtime.Frame {
	if maxBytes <= 0 {
		maxBytes = maxRealtimePayloadBytes
	}
	out := make([]realtime.Frame, 0, len(current)+len(retained))
	positions := make(map[string]int, len(current)+len(retained))
	for _, frame := range current {
		key, ok := checkpointFrameKey(frame)
		if !ok {
			continue
		}
		positions[key] = len(out)
		out = append(out, cloneRealtimeFrame(frame))
	}
	for _, frame := range retained {
		key, ok := checkpointFrameKey(frame)
		if !ok {
			continue
		}
		if index, exists := positions[key]; exists {
			currentFrame := out[index]
			typ, _ := frame["T"].(string)
			if typ == "f" || typ == "index-impact" {
				if typ == "f" && hasForeignSnapshotAmounts(frame) && !hasForeignSnapshotAmounts(currentFrame) {
					out[index] = cloneRealtimeFrame(frame)
					continue
				}
				currentTime, currentOK := contextFrameSourceTime(currentFrame, typ)
				retainedTime, retainedOK := contextFrameSourceTime(frame, typ)
				if currentOK && retainedOK && retainedTime.After(currentTime) {
					out[index] = cloneRealtimeFrame(frame)
				}
			} else {
				out[index] = cloneRealtimeFrame(frame)
			}
			continue
		}
		positions[key] = len(out)
		out = append(out, cloneRealtimeFrame(frame))
	}
	for len(out) > 0 {
		payload, err := json.Marshal(out)
		if err == nil && len(payload) <= maxBytes {
			return out
		}
		removeIndex := -1
		for index := len(out) - 1; index >= 0; index-- {
			typ, _ := out[index]["T"].(string)
			if typ != "f" && typ != "index-impact" {
				removeIndex = index
				break
			}
		}
		if removeIndex < 0 {
			return nil
		}
		out = append(out[:removeIndex], out[removeIndex+1:]...)
	}
	return nil
}

func checkpointFrameKey(frame realtime.Frame) (string, bool) {
	typ, _ := frame["T"].(string)
	symbol, _ := frame["symbol"].(string)
	if typ == "mi" && strings.TrimSpace(symbol) == "" {
		symbol, _ = frame["indexName"].(string)
	}
	typ = strings.TrimSpace(typ)
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" || typ == "" {
		return "", false
	}
	return typ + ":" + symbol, true
}
