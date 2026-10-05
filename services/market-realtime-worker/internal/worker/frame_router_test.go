package worker

import (
	"testing"
	"time"

	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/realtime"
)

func TestMarketFrameRouterRoutesMarketFramesAndKeepsBookOnlyStateIsolated(t *testing.T) {
	checkpoint := realtime.NewBuffer(64 * 1024)
	market := realtime.NewBuffer(64 * 1024)
	orderbook := realtime.NewOrderbookBuffer(1, 64*1024, 100)
	sourceTime := time.Unix(1791166985, 664143789).UTC()
	contextSnapshots := newContextSnapshotBuffer(vietnamDateKey(sourceTime), maxContextSnapshotBytes)
	contextSnapshots.SetUniverse([]string{"HPG"})
	router := newMarketFrameRouter(checkpoint, market, orderbook, contextSnapshots)

	router.OnTickFrame(map[string]any{
		"T": "t", "symbol": "HPG", "matchPrice": 25_100, "matchQtty": 100,
	})
	if got := len(checkpoint.Drain()); got != 1 {
		t.Fatalf("tick checkpoint frame count=%d want 1", got)
	}
	if frames := market.Drain(); len(frames) != 1 || frames[0]["T"] != "t" {
		t.Fatalf("tick market frames=%v want one t frame", frames)
	}
	if batch := orderbook.DrainShard(0); len(batch.Frames) != 1 || batch.Frames[0]["T"] != "t" {
		t.Fatalf("tick orderbook frames=%v want one t frame", batch.Frames)
	}

	router.OnOrderbookFrame(map[string]any{
		"T": "q", "symbol": "HPG", "bidPrice": 25_000, "bidQtty": 200,
	})
	if got := checkpoint.Len(); got != 0 {
		t.Fatalf("book-only q frame entered checkpoint, len=%d", got)
	}
	if got := market.Len(); got != 0 {
		t.Fatalf("book-only q frame entered market relay, len=%d", got)
	}
	if batch := orderbook.DrainShard(0); len(batch.Frames) != 1 || batch.Frames[0]["T"] != "q" {
		t.Fatalf("q orderbook frames=%v want one q frame", batch.Frames)
	}

	router.OnOrderbookFrame(testForeignSnapshot("HPG", sourceTime))
	if frames := market.Drain(); len(frames) != 1 || frames[0]["T"] != "f" {
		t.Fatalf("foreign market frames=%v want one f frame", frames)
	}
	if batch := orderbook.DrainShard(0); len(batch.Frames) != 1 || batch.Frames[0]["T"] != "f" {
		t.Fatalf("foreign orderbook frames=%v want one f frame", batch.Frames)
	}
	if got := contextSnapshots.Len(); got != 1 {
		t.Fatalf("retained foreign snapshots=%d want 1", got)
	}
	if got := checkpoint.Len(); got != 0 {
		t.Fatalf("accepted foreign snapshot entered transient checkpoint, len=%d", got)
	}
}
