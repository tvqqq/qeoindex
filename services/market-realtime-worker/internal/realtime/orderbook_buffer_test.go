package realtime

import (
	"encoding/json"
	"testing"
)

func TestOrderbookBufferCoalescesStateButPreservesExecutionsInOrder(t *testing.T) {
	buffer := NewOrderbookBuffer(10, 196608, 2000)
	buffer.Push(Frame{"T": "q", "symbol": "VCB", "matchPrice": 60.0})
	buffer.Push(Frame{"T": "q", "symbol": "VCB", "matchPrice": 60.1})
	buffer.Push(Frame{"T": "te", "symbol": "VCB", "transId": "1", "matchPrice": 60.0})
	buffer.Push(Frame{"T": "te", "symbol": "VCB", "transId": "2", "matchPrice": 60.1})

	shard := FanoutShard("VCB", 10)
	batch := buffer.DrainShard(shard)
	if batch.ContinuityGap {
		t.Fatal("healthy batch must not report continuity gap")
	}

	var quotes, executions int
	var executionIDs []string
	for _, frame := range batch.Frames {
		switch frame["T"] {
		case "q":
			quotes++
			if frame["matchPrice"] != 60.1 {
				t.Fatalf("expected latest quote, got %#v", frame)
			}
		case "te":
			executions++
			executionIDs = append(executionIDs, frame["transId"].(string))
		}
	}
	if quotes != 1 {
		t.Fatalf("expected one coalesced quote, got %d", quotes)
	}
	if executions != 2 {
		t.Fatalf("expected two executions, got %d", executions)
	}
	if executionIDs[0] != "1" || executionIDs[1] != "2" {
		t.Fatalf("execution order changed: %#v", executionIDs)
	}
}

func TestOrderbookBufferCoalescesExpectedPriceAsLatestState(t *testing.T) {
	buffer := NewOrderbookBuffer(10, 196608, 2000)
	buffer.Push(Frame{"T": "e", "symbol": "MSN", "expectedTradePrice": 66.1, "expectedTradeQuantity": 100})
	buffer.Push(Frame{"T": "e", "symbol": "MSN", "expectedTradePrice": 66.2, "expectedTradeQuantity": 250})

	shard := FanoutShard("MSN", 10)
	batch := buffer.DrainShard(shard)
	if len(batch.Frames) != 1 {
		t.Fatalf("expected one coalesced expected-price frame, got %d", len(batch.Frames))
	}
	frame := batch.Frames[0]
	if frame["T"] != "e" || frame["expectedTradePrice"] != 66.2 || frame["expectedTradeQuantity"] != 250 {
		t.Fatalf("expected latest auction indication, got %#v", frame)
	}
}

func TestOrderbookBufferRequeueKeepsOlderExecutionsBeforeNewerFrames(t *testing.T) {
	buffer := NewOrderbookBuffer(10, 196608, 2000)
	buffer.Push(Frame{"T": "te", "symbol": "VCB", "transId": "1"})
	shard := FanoutShard("VCB", 10)
	failed := buffer.DrainShard(shard)

	buffer.Push(Frame{"T": "te", "symbol": "VCB", "transId": "2"})
	buffer.RequeueShard(shard, failed)
	retry := buffer.DrainShard(shard)

	if len(retry.Frames) != 2 {
		t.Fatalf("expected 2 executions after requeue, got %d", len(retry.Frames))
	}
	if retry.Frames[0]["transId"] != "1" || retry.Frames[1]["transId"] != "2" {
		t.Fatalf("requeue reordered executions: %#v", retry.Frames)
	}
}

func TestOrderbookBufferRequeueRestoresExpectedPriceState(t *testing.T) {
	buffer := NewOrderbookBuffer(10, 196608, 2000)
	buffer.Push(Frame{"T": "e", "symbol": "MSN", "expectedTradePrice": 66.1, "expectedTradeQuantity": 100})
	shard := FanoutShard("MSN", 10)
	failed := buffer.DrainShard(shard)

	buffer.RequeueShard(shard, failed)
	retry := buffer.DrainShard(shard)
	if len(retry.Frames) != 1 || retry.Frames[0]["T"] != "e" {
		t.Fatalf("expected auction state to survive requeue, got %#v", retry.Frames)
	}
}

func TestOrderbookBufferMarksContinuityGapWhenExecutionQueueOverflows(t *testing.T) {
	buffer := NewOrderbookBuffer(10, 196608, 2)
	buffer.Push(Frame{"T": "te", "symbol": "VCB", "transId": "1"})
	buffer.Push(Frame{"T": "te", "symbol": "VCB", "transId": "2"})
	buffer.Push(Frame{"T": "te", "symbol": "VCB", "transId": "3"})

	shard := FanoutShard("VCB", 10)
	batch := buffer.DrainShard(shard)
	if !batch.ContinuityGap {
		t.Fatal("overflow must be explicit to browser recovery")
	}
	if buffer.GapCount() != 1 {
		t.Fatalf("expected one recorded gap, got %d", buffer.GapCount())
	}
}

func TestJSONBatchSizerMatchesActualJSONArrayBytes(t *testing.T) {
	frames := []Frame{
		{"T": "q", "symbol": "MSN", "bid": []any{map[string]any{"price": 67.0, "qtty": 100}}},
		{"T": "te", "symbol": "MSN", "transId": "1", "matchPrice": 67.1, "matchQtty": 10},
		{"T": "f", "symbol": "MSN", "buyVolume": 1000, "sellVolume": 500},
	}
	encoded, err := json.Marshal(frames)
	if err != nil {
		t.Fatal(err)
	}

	sizer := newJSONBatchSizer(len(encoded))
	for _, frame := range frames {
		if !sizer.TryAdd(frame) {
			t.Fatalf("expected frame to fit within exact JSON payload budget: %#v", frame)
		}
	}
	if got := sizer.Bytes(); got != len(encoded) {
		t.Fatalf("sizer bytes=%d want actual JSON bytes=%d", got, len(encoded))
	}
}

func TestJSONBatchSizerRejectsOverflowWithoutChangingSize(t *testing.T) {
	first := Frame{"T": "te", "symbol": "MSN", "transId": "1", "matchPrice": 67.1, "matchQtty": 10}
	second := Frame{"T": "te", "symbol": "MSN", "transId": "2", "matchPrice": 67.1, "matchQtty": 10}
	encodedFirst, err := json.Marshal([]Frame{first})
	if err != nil {
		t.Fatal(err)
	}

	sizer := newJSONBatchSizer(len(encodedFirst))
	if !sizer.TryAdd(first) {
		t.Fatal("first frame should fit exact payload budget")
	}
	before := sizer.Bytes()
	if sizer.TryAdd(second) {
		t.Fatal("second frame should exceed payload budget")
	}
	if got := sizer.Bytes(); got != before {
		t.Fatalf("rejected frame changed payload size: got %d want %d", got, before)
	}
}

func TestFanoutShardIsStableForKnownSymbols(t *testing.T) {
	vectors := map[string]int{
		"VCB": 4,
		"FPT": 3,
		"MSN": 5,
		"VIC": 9,
	}
	for symbol, want := range vectors {
		if got := FanoutShard(symbol, 10); got != want {
			t.Fatalf("FanoutShard(%s)=%d want %d", symbol, got, want)
		}
	}
}
