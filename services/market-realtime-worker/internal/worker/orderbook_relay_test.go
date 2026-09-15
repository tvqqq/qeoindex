package worker

import (
	"testing"

	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/realtime"
)

func TestGroupOrderbookRelayFramesPropagatesShardGapToQuietSymbols(t *testing.T) {
	const shardCount = orderbookFanoutShards
	active := "MSN"
	quiet := "HAG"
	shard := realtime.FanoutShard(active, shardCount)
	if realtime.FanoutShard(quiet, shardCount) != shard {
		t.Fatalf("fixture drift: %s and %s must share fanout shard", active, quiet)
	}

	frames := []realtime.Frame{{"T": "q", "symbol": active, "bidPrice1": 67.0}}
	grouped := groupOrderbookRelayFrames(frames, []string{active, quiet}, shard, true)

	if len(grouped[active]) != 1 {
		t.Fatalf("active symbol frames = %d, want 1", len(grouped[active]))
	}
	if _, ok := grouped[quiet]; !ok {
		t.Fatalf("quiet symbol %s must receive an empty continuity-gap envelope", quiet)
	}
	if len(grouped[quiet]) != 0 {
		t.Fatalf("quiet symbol frames = %d, want 0", len(grouped[quiet]))
	}
}

func TestGroupOrderbookRelayFramesDoesNotFanOutQuietSymbolsWithoutGap(t *testing.T) {
	const shardCount = orderbookFanoutShards
	active := "MSN"
	shard := realtime.FanoutShard(active, shardCount)
	frames := []realtime.Frame{{"T": "q", "symbol": active}}

	grouped := groupOrderbookRelayFrames(frames, []string{active, "HAG"}, shard, false)
	if len(grouped) != 1 {
		t.Fatalf("group count = %d, want only active symbol", len(grouped))
	}
	if len(grouped[active]) != 1 {
		t.Fatalf("active symbol frames = %d, want 1", len(grouped[active]))
	}
}
