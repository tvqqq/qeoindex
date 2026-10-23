package realtime

import (
	"encoding/json"
	"testing"
)

func TestBufferCoalescesLatestFrameByTypeAndSymbol(t *testing.T) {
	b := NewBuffer(524288)
	b.Push(Frame{"T": "t", "symbol": "VCB", "price": 1})
	b.Push(Frame{"T": "t", "symbol": "VCB", "price": 2})
	b.Push(Frame{"T": "mi", "indexName": "VNINDEX", "index": 100})
	frames := b.Drain()
	if len(frames) != 2 {
		t.Fatalf("got %d frames", len(frames))
	}
	if frames[0]["price"] != 2 {
		t.Fatalf("latest VCB frame not retained: %#v", frames[0])
	}
}

func TestBufferAcceptsCumulativeForeignAndVNINDEXImpactSnapshots(t *testing.T) {
	b := NewBuffer(524288)
	b.Push(Frame{"T": "f", "symbol": "HPG", "totalBuyTradedAmount": 10.0})
	b.Push(Frame{"T": "f", "symbol": "HPG", "totalBuyTradedAmount": 0.0})
	b.Push(Frame{"T": "index-impact", "symbol": "VNINDEX", "providerAsOf": "2026-10-05T02:15:00Z", "rows": []any{map[string]any{"symbol": "VCB", "basketInfluence": 1.2}}})
	b.Push(Frame{"T": "index-impact", "symbol": "VNINDEX", "providerAsOf": "2026-10-05T02:15:12Z", "rows": []any{map[string]any{"symbol": "VCB", "basketInfluence": 1.4}}})

	frames := b.Drain()
	if len(frames) != 2 {
		t.Fatalf("expected two coalesced snapshots, got %d", len(frames))
	}
	if frames[0]["totalBuyTradedAmount"] != 0.0 {
		t.Fatalf("foreign cumulative zero was not preserved: %#v", frames[0])
	}
	if frames[1]["providerAsOf"] != "2026-10-05T02:15:12Z" {
		t.Fatalf("latest impact frame was not retained: %#v", frames[1])
	}
}

func TestBufferRejectsOlderProviderFramesAndAcceptsEqualTimeCorrections(t *testing.T) {
	tests := []struct {
		name    string
		newer   Frame
		older   Frame
		correct Frame
		field   string
	}{
		{
			name:    "market index",
			newer:   Frame{"T": "mi", "indexName": "VNINDEX", "transactTime": map[string]any{"Seconds": float64(1_791_167_740), "Nanos": float64(77_000_000)}, "valueIndexes": 1_751.0},
			older:   Frame{"T": "mi", "indexName": "VNINDEX", "transactTime": map[string]any{"Seconds": float64(1_791_167_739), "Nanos": float64(999_000_000)}, "valueIndexes": 1_749.0, "_qeoWorkerReceivedAt": int64(1_791_200_000_000)},
			correct: Frame{"T": "mi", "indexName": "VNINDEX", "transactTime": map[string]any{"Seconds": float64(1_791_167_740), "Nanos": float64(77_000_000)}, "valueIndexes": 1_752.0},
			field:   "valueIndexes",
		},
		{
			name:    "foreign snapshot",
			newer:   Frame{"T": "f", "symbol": "HPG", "multicastReceiveTime": map[string]any{"Seconds": float64(1_791_167_740), "Nanos": float64(77_000_000)}, "totalBuyTradedAmount": 20.0},
			older:   Frame{"T": "f", "symbol": "HPG", "multicastReceiveTime": map[string]any{"Seconds": float64(1_791_167_739), "Nanos": float64(999_000_000)}, "totalBuyTradedAmount": 10.0, "_qeoWorkerReceivedAt": int64(1_791_200_000_000)},
			correct: Frame{"T": "f", "symbol": "HPG", "multicastReceiveTime": map[string]any{"Seconds": float64(1_791_167_740), "Nanos": float64(77_000_000)}, "totalBuyTradedAmount": 0.0},
			field:   "totalBuyTradedAmount",
		},
		{
			name:    "index impact",
			newer:   Frame{"T": "index-impact", "symbol": "VNINDEX", "providerAsOf": "2026-10-05T02:22:20.077Z", "marker": "newer"},
			older:   Frame{"T": "index-impact", "symbol": "VNINDEX", "providerAsOf": "2026-10-05T02:22:19.999Z", "marker": "older", "_qeoWorkerReceivedAt": int64(1_791_200_000_000)},
			correct: Frame{"T": "index-impact", "symbol": "VNINDEX", "providerAsOf": "2026-10-05T02:22:20.077Z", "marker": "correction"},
			field:   "marker",
		},
		{
			name:    "futures OHLC",
			newer:   Frame{"T": "b", "symbol": "41I1G4000", "symbolType": "VN30F1M", "resolution": "1", "time": float64(1_791_167_740), "close": 1882.1},
			older:   Frame{"T": "b", "symbol": "41I1G4000", "symbolType": "VN30F1M", "resolution": "1", "time": float64(1_791_167_739), "close": 1881.9, "_qeoWorkerReceivedAt": int64(1_791_200_000_000)},
			correct: Frame{"T": "b", "symbol": "41I1G4000", "symbolType": "VN30F1M", "resolution": "1", "time": float64(1_791_167_740), "close": 1882.2},
			field:   "close",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := NewBuffer(524288)
			b.Push(tt.newer)
			b.Push(tt.older)
			frames := b.Drain()
			if len(frames) != 1 || frames[0][tt.field] != tt.newer[tt.field] {
				t.Fatalf("older provider time replaced the queued frame: %#v", frames)
			}

			b.Push(tt.newer)
			b.Push(tt.correct)
			frames = b.Drain()
			if len(frames) != 1 || frames[0][tt.field] != tt.correct[tt.field] {
				t.Fatalf("equal-time provider correction was not accepted: %#v", frames)
			}
		})
	}
}

func TestBufferSeparatesOHLCByInstrumentContractAndResolution(t *testing.T) {
	b := NewBuffer(524288)
	b.Push(Frame{"T": "b", "symbol": "VN30", "symbolType": "VN30", "resolution": "1", "time": float64(1_791_167_740), "close": 1880.0})
	b.Push(Frame{"T": "b", "symbol": "41I1G4000", "symbolType": "VN30F1M", "resolution": "1", "time": float64(1_791_167_740), "close": 1882.1})
	b.Push(Frame{"T": "b", "symbol": "41I1G5000", "symbolType": "VN30F1M", "resolution": "1", "time": float64(1_791_167_740), "close": 1883.1})
	b.Push(Frame{"T": "b", "symbol": "41I1G4000", "symbolType": "VN30F1M", "resolution": "5", "time": float64(1_791_167_740), "close": 1882.1})

	frames := b.Drain()
	if len(frames) != 4 {
		t.Fatalf("expected spot, two futures contracts, and a separate resolution; got %#v", frames)
	}
}

func TestBufferDoesNotInventMissingOHLCFields(t *testing.T) {
	b := NewBuffer(524288)
	incomplete := Frame{"T": "b", "symbol": "41I1G4000", "symbolType": "VN30F1M", "resolution": "1", "time": float64(1_791_167_740), "open": 1880.0}
	b.Push(incomplete)

	frames := b.Drain()
	if len(frames) != 1 || frames[0]["open"] != 1880.0 {
		t.Fatalf("incomplete provider frame was not preserved as received: %#v", frames)
	}
	for _, field := range []string{"high", "low", "close", "volume"} {
		if _, exists := frames[0][field]; exists {
			t.Fatalf("buffer fabricated missing %s in %#v", field, frames[0])
		}
	}
}

func TestBufferTrimsToPayloadBudget(t *testing.T) {
	b := NewBuffer(180)
	b.Push(Frame{"T": "t", "symbol": "AAA", "payload": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})
	b.Push(Frame{"T": "t", "symbol": "BBB", "payload": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"})
	frames := b.Drain()
	payload, _ := json.Marshal(frames)
	if len(payload) > 180 {
		t.Fatalf("payload %d exceeds budget", len(payload))
	}
}

func TestRequeueDoesNotOverwriteNewerFrame(t *testing.T) {
	b := NewBuffer(524288)
	b.Push(Frame{"T": "t", "symbol": "VCB", "price": 1})
	old := b.Drain()
	b.Push(Frame{"T": "t", "symbol": "VCB", "price": 2})
	b.Requeue(old)
	frames := b.Drain()
	if frames[0]["price"] != 2 {
		t.Fatalf("requeue overwrote newer frame: %#v", frames[0])
	}
}

func TestRequeueRestoresDrainedFrameWhenNoNewerFrameArrives(t *testing.T) {
	b := NewBuffer(524288)
	b.Push(Frame{"T": "t", "symbol": "VCB", "price": 1})
	drained := b.Drain()
	b.Requeue(drained)
	frames := b.Drain()
	if len(frames) != 1 || frames[0]["price"] != 1 {
		t.Fatalf("drained frame disappeared during requeue: %#v", frames)
	}
}
