package worker

import (
	"fmt"
	"strings"
)

const (
	maxOrderbookSupplementalSockets          = 4
	orderbookSupplementalFeedsPerSymbol      = 4
	maxOrderbookMembershipsPerSocket         = 200
	maxOrderbookSymbolsPerSocket             = maxOrderbookMembershipsPerSocket / orderbookSupplementalFeedsPerSymbol
	maxOrderbookUniverse                     = maxOrderbookSupplementalSockets * maxOrderbookSymbolsPerSocket
)

func PlanOrderbookShards(symbols []string) ([][]string, error) {
	seen := make(map[string]struct{}, len(symbols))
	normalized := make([]string, 0, len(symbols))
	for _, raw := range symbols {
		symbol := strings.ToUpper(strings.TrimSpace(raw))
		if symbol == "" {
			continue
		}
		if _, exists := seen[symbol]; exists {
			continue
		}
		seen[symbol] = struct{}{}
		normalized = append(normalized, symbol)
	}

	if len(normalized) > maxOrderbookUniverse {
		return nil, fmt.Errorf("orderbook universe %d exceeds fixed provider capacity %d", len(normalized), maxOrderbookUniverse)
	}
	if len(normalized) == 0 {
		return nil, fmt.Errorf("orderbook universe is empty")
	}

	shards := make([][]string, 0, maxOrderbookSupplementalSockets)
	for start := 0; start < len(normalized); start += maxOrderbookSymbolsPerSocket {
		end := start + maxOrderbookSymbolsPerSocket
		if end > len(normalized) {
			end = len(normalized)
		}
		shards = append(shards, append([]string(nil), normalized[start:end]...))
	}
	return shards, nil
}

func sameOrderbookShardPlan(left, right [][]string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if len(left[i]) != len(right[i]) {
			return false
		}
		for j := range left[i] {
			if left[i][j] != right[i][j] {
				return false
			}
		}
	}
	return true
}
