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
