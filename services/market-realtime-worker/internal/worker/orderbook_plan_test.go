package worker

import (
	"fmt"
	"testing"
)

func TestPlanOrderbookShardsBoundsTwoHundredSymbolsAcrossFourSockets(t *testing.T) {
	symbols := make([]string, 0, 200)
	for i := 0; i < 200; i++ {
		symbols = append(symbols, fmt.Sprintf("S%03d", i))
	}

	shards, err := PlanOrderbookShards(symbols)
	if err != nil {
		t.Fatalf("PlanOrderbookShards returned error: %v", err)
	}
	if len(shards) != 4 {
		t.Fatalf("expected 4 supplemental shards, got %d", len(shards))
	}

	seen := map[string]bool{}
	for index, shard := range shards {
		if len(shard) != 50 {
			t.Fatalf("shard %d expected 50 symbols, got %d", index, len(shard))
		}
		memberships := len(shard) * orderbookSupplementalFeedsPerSymbol
		if memberships > maxOrderbookMembershipsPerSocket {
			t.Fatalf("shard %d uses %d provider memberships, max is %d", index, memberships, maxOrderbookMembershipsPerSocket)
		}
		if memberships != 200 {
			t.Fatalf("shard %d expected 200 memberships for 50 symbols x 4 feeds, got %d", index, memberships)
		}
		for _, symbol := range shard {
			if seen[symbol] {
				t.Fatalf("duplicate symbol %s", symbol)
			}
			seen[symbol] = true
		}
	}
	if len(seen) != 200 {
		t.Fatalf("expected 200 unique symbols, got %d", len(seen))
	}
}

func TestPlanOrderbookShardsFailsClosedAboveProviderCapacity(t *testing.T) {
	symbols := make([]string, 0, 201)
	for i := 0; i < 201; i++ {
		symbols = append(symbols, fmt.Sprintf("S%03d", i))
	}

	if _, err := PlanOrderbookShards(symbols); err == nil {
		t.Fatal("expected capacity error for 201 symbols")
	}
}
