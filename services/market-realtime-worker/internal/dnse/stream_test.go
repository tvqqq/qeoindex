package dnse

import "testing"

func TestShouldSignalContinuityGapOnlyAfterAuthenticatedStreamBreak(t *testing.T) {
	if shouldSignalContinuityGap(false) {
		t.Fatal("pre-authentication connection failures must not report a data continuity gap")
	}
	if !shouldSignalContinuityGap(true) {
		t.Fatal("an authenticated stream break can lose provider frames and must report a continuity gap")
	}
}

func TestOrderbookChannelsIncludeAuctionExpectedPrice(t *testing.T) {
	symbols := []string{"MSN", "FPT"}
	channels := OrderbookChannels(symbols)
	wantNames := []string{
		"top_price.G1.json",
		"tick_extra.G1.json",
		"foreign.G1.json",
		"expected_price.G1.json",
	}

	if len(channels) != len(wantNames) {
		t.Fatalf("expected %d supplemental orderbook channels, got %d", len(wantNames), len(channels))
	}
	for index, wantName := range wantNames {
		channel := channels[index]
		if channel.Name != wantName {
			t.Fatalf("channel %d=%q want %q", index, channel.Name, wantName)
		}
		if len(channel.Symbols) != len(symbols) {
			t.Fatalf("channel %s expected %d symbols, got %d", channel.Name, len(symbols), len(channel.Symbols))
		}
		for symbolIndex, wantSymbol := range symbols {
			if channel.Symbols[symbolIndex] != wantSymbol {
				t.Fatalf("channel %s symbol %d=%q want %q", channel.Name, symbolIndex, channel.Symbols[symbolIndex], wantSymbol)
			}
		}
	}
}
