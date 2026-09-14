package realtime

import "testing"

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
