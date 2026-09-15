package realtime

import (
	"encoding/json"
	"hash/fnv"
	"strings"
	"sync"
)

type OrderbookBatch struct {
	Frames        []Frame
	ContinuityGap bool
	Epoch         int64
}

type orderbookShardBuffer struct {
	state         map[string]Frame
	stateOrder    []string
	executions    []Frame
	continuityGap bool
	epoch         int64
}

type OrderbookBuffer struct {
	mu                 sync.Mutex
	shards             []orderbookShardBuffer
	maxPayloadBytes    int
	maxExecutionFrames int
	gapCount           int64
}

func NewOrderbookBuffer(shardCount, maxPayloadBytes, maxExecutionFrames int) *OrderbookBuffer {
	if shardCount <= 0 {
		shardCount = 10
	}
	if maxPayloadBytes <= 0 {
		maxPayloadBytes = 196608
	}
	if maxExecutionFrames <= 0 {
		maxExecutionFrames = 2000
	}
	shards := make([]orderbookShardBuffer, shardCount)
	for index := range shards {
		shards[index].state = map[string]Frame{}
	}
	return &OrderbookBuffer{
		shards:             shards,
		maxPayloadBytes:    maxPayloadBytes,
		maxExecutionFrames: maxExecutionFrames,
	}
}

func FanoutShard(symbol string, shardCount int) int {
	if shardCount <= 0 {
		return 0
	}
	hasher := fnv.New32a()
	_, _ = hasher.Write([]byte(strings.ToUpper(strings.TrimSpace(symbol))))
	return int(hasher.Sum32() % uint32(shardCount))
}

func (b *OrderbookBuffer) Push(frame Frame) {
	typ, _ := frame["T"].(string)
	typ = strings.TrimSpace(typ)
	if typ != "t" && typ != "q" && typ != "f" && typ != "e" && typ != "te" {
		return
	}
	symbol, _ := frame["symbol"].(string)
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return
	}
	copyFrame := cloneFrame(frame)
	copyFrame["symbol"] = symbol

	b.mu.Lock()
	defer b.mu.Unlock()
	shard := &b.shards[FanoutShard(symbol, len(b.shards))]
	if typ == "te" {
		shard.executions = append(shard.executions, copyFrame)
		if len(shard.executions) > b.maxExecutionFrames {
			overflow := len(shard.executions) - b.maxExecutionFrames
			shard.executions = append([]Frame(nil), shard.executions[overflow:]...)
			b.markGapLocked(shard)
		}
		return
	}

	key := typ + ":" + symbol
	if _, exists := shard.state[key]; !exists {
		shard.stateOrder = append(shard.stateOrder, key)
	}
	shard.state[key] = copyFrame
}

func (b *OrderbookBuffer) MarkContinuityGapAll() {
	b.mu.Lock()
	defer b.mu.Unlock()
	for index := range b.shards {
		b.markGapLocked(&b.shards[index])
	}
}

func (b *OrderbookBuffer) DrainShard(shardIndex int) OrderbookBatch {
	b.mu.Lock()
	defer b.mu.Unlock()
	if shardIndex < 0 || shardIndex >= len(b.shards) {
		return OrderbookBatch{}
	}
	shard := &b.shards[shardIndex]
	if len(shard.state) == 0 && len(shard.executions) == 0 {
		return OrderbookBatch{}
	}

	frames := make([]Frame, 0, len(shard.state)+len(shard.executions))
	selectedStateKeys := make([]string, 0, len(shard.stateOrder))
	for _, key := range shard.stateOrder {
		frame, ok := shard.state[key]
		if !ok {
			continue
		}
		candidate := append(append([]Frame(nil), frames...), frame)
		if payloadFits(candidate, b.maxPayloadBytes) {
			frames = append(frames, frame)
			selectedStateKeys = append(selectedStateKeys, key)
		}
	}

	executionCount := 0
	for _, frame := range shard.executions {
		candidate := append(append([]Frame(nil), frames...), frame)
		if !payloadFits(candidate, b.maxPayloadBytes) {
			break
		}
		frames = append(frames, frame)
		executionCount++
	}

	if len(frames) == 0 {
		return OrderbookBatch{}
	}
	selected := make(map[string]struct{}, len(selectedStateKeys))
	for _, key := range selectedStateKeys {
		selected[key] = struct{}{}
		delete(shard.state, key)
	}
	if len(selected) > 0 {
		nextOrder := shard.stateOrder[:0]
		for _, key := range shard.stateOrder {
			if _, remove := selected[key]; !remove {
				nextOrder = append(nextOrder, key)
			}
		}
		shard.stateOrder = append([]string(nil), nextOrder...)
	}
	if executionCount > 0 {
		shard.executions = append([]Frame(nil), shard.executions[executionCount:]...)
	}

	batch := OrderbookBatch{
		Frames:        cloneFrames(frames),
		ContinuityGap: shard.continuityGap,
		Epoch:         shard.epoch,
	}
	shard.continuityGap = false
	return batch
}

func (b *OrderbookBuffer) RequeueShard(shardIndex int, batch OrderbookBatch) {
	if len(batch.Frames) == 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if shardIndex < 0 || shardIndex >= len(b.shards) {
		return
	}
	shard := &b.shards[shardIndex]

	olderExecutions := make([]Frame, 0)
	for _, frame := range batch.Frames {
		typ, _ := frame["T"].(string)
		symbol, _ := frame["symbol"].(string)
		typ = strings.TrimSpace(typ)
		symbol = strings.ToUpper(strings.TrimSpace(symbol))
		if typ == "te" {
			olderExecutions = append(olderExecutions, cloneFrame(frame))
			continue
		}
		if (typ != "t" && typ != "q" && typ != "f" && typ != "e") || symbol == "" {
			continue
		}
		key := typ + ":" + symbol
		if _, newerExists := shard.state[key]; newerExists {
			continue
		}
		shard.state[key] = cloneFrame(frame)
		shard.stateOrder = append([]string{key}, shard.stateOrder...)
	}
	if len(olderExecutions) > 0 {
		combined := make([]Frame, 0, len(olderExecutions)+len(shard.executions))
		combined = append(combined, olderExecutions...)
		combined = append(combined, shard.executions...)
		if len(combined) > b.maxExecutionFrames {
			drop := len(combined) - b.maxExecutionFrames
			combined = combined[drop:]
			b.markGapLocked(shard)
		}
		shard.executions = append([]Frame(nil), combined...)
	}
	if batch.ContinuityGap {
		shard.continuityGap = true
		if batch.Epoch > shard.epoch {
			shard.epoch = batch.Epoch
		}
	}
}

func (b *OrderbookBuffer) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	total := 0
	for index := range b.shards {
		total += len(b.shards[index].state) + len(b.shards[index].executions)
	}
	return total
}

func (b *OrderbookBuffer) GapCount() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.gapCount
}

func (b *OrderbookBuffer) markGapLocked(shard *orderbookShardBuffer) {
	if shard.continuityGap {
		return
	}
	shard.continuityGap = true
	shard.epoch++
	b.gapCount++
}

func payloadFits(frames []Frame, maxBytes int) bool {
	encoded, err := json.Marshal(frames)
	return err == nil && len(encoded) <= maxBytes
}

func cloneFrame(frame Frame) Frame {
	out := make(Frame, len(frame))
	for key, value := range frame {
		out[key] = value
	}
	return out
}

func cloneFrames(frames []Frame) []Frame {
	out := make([]Frame, len(frames))
	for index, frame := range frames {
		out[index] = cloneFrame(frame)
	}
	return out
}
