package worker

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/realtime"
)

func testForeignSnapshot(symbol string, sourceTime time.Time) realtime.Frame {
	return realtime.Frame{
		"T":                            "f",
		"symbol":                       symbol,
		"boardId":                      "G1",
		"marketId":                     "STO",
		"tradingSessionId":             40,
		"buyTradedAmount":              float64(42667830000),
		"totalBuyTradedAmount":         float64(42667830000),
		"sellTradedAmount":             float64(14527550000),
		"totalSellTradedAmount":        float64(14527550000),
		"buyVolume":                    2075600,
		"totalBuyVolume":               2075600,
		"sellVolume":                   710800,
		"totalSellVolume":              710800,
		"foreignInvestorTypeCode":      10,
		"foreignerBuyPossibleQuantity": 4137052614,
		"foreignerOrderLimitQuantity":  2314625956,
		"transactTime":                 "022300018",
		"multicastReceiveTime":         map[string]any{"Seconds": sourceTime.Unix(), "Nanos": sourceTime.Nanosecond()},
		"_qeoWorkerReceivedAt":         sourceTime.UnixMilli(),
	}
}

func testIndexImpactFrame(sourceTime time.Time) realtime.Frame {
	return realtime.Frame{
		"T":      "index-impact",
		"symbol": "VNINDEX",
		"rows": []any{map[string]any{
			"symbol": "HDB", "basketInfluence": -0.71623814,
			"time": map[string]any{"seconds": sourceTime.Unix(), "nanos": sourceTime.Nanosecond()},
		}},
		"providerAsOf": sourceTime.Format(time.RFC3339Nano),
	}
}

func testProviderSourceTime() time.Time {
	return time.Unix(1791166985, 664143789).UTC()
}

func TestContextSnapshotBufferRetainsSparseSessionAndPrunesUniverse(t *testing.T) {
	sourceTime := testProviderSourceTime()
	if got := vietnamDateKey(sourceTime); got != "2026-10-05" {
		t.Fatalf("fixture ICT date=%q want 2026-10-05", got)
	}
	symbols := make([]string, 0, maxContextSnapshotSymbols)
	symbols = append(symbols, "HPG")
	for index := 1; index < maxContextSnapshotSymbols; index++ {
		symbols = append(symbols, fmt.Sprintf("S%03d", index))
	}

	buffer := newContextSnapshotBuffer("2026-10-05", maxContextSnapshotBytes)
	buffer.SetUniverse(symbols)
	for _, symbol := range symbols {
		if !buffer.Push(testForeignSnapshot(symbol, sourceTime)) {
			t.Fatalf("failed to retain current-session foreign frame for %s", symbol)
		}
	}
	impact := testIndexImpactFrame(sourceTime)
	if !buffer.Push(impact) {
		t.Fatal("failed to retain current-session VNINDEX impact frame")
	}
	if buffer.Push(testForeignSnapshot("HPG", sourceTime.Add(-24*time.Hour))) {
		t.Fatal("previous-session foreign frame must be rejected")
	}

	snapshot := buffer.Snapshot()
	if got := len(snapshot); got != maxContextSnapshotSymbols+1 {
		t.Fatalf("sparse snapshot count=%d want %d", got, maxContextSnapshotSymbols+1)
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal retained snapshot: %v", err)
	}
	if len(encoded) > maxContextSnapshotBytes || buffer.currentSize > maxContextSnapshotBytes {
		t.Fatalf("retained snapshot exceeded byte cap: encoded=%d accounted=%d cap=%d", len(encoded), buffer.currentSize, maxContextSnapshotBytes)
	}

	merged := combineCheckpointFrames(nil, snapshot, maxRealtimePayloadBytes)
	if got := len(merged); got != maxContextSnapshotSymbols+1 {
		t.Fatalf("checkpoint frame count=%d want %d", got, maxContextSnapshotSymbols+1)
	}
	var mergedImpact realtime.Frame
	for _, frame := range merged {
		if frame["T"] == "index-impact" {
			mergedImpact = frame
			break
		}
	}
	if mergedImpact == nil || mergedImpact["providerAsOf"] != impact["providerAsOf"] {
		t.Fatalf("checkpoint merge changed or lost impact asOf: got=%v want=%v", mergedImpact, impact["providerAsOf"])
	}

	buffer.SetUniverse([]string{"HPG"})
	pruned := buffer.Snapshot()
	if got := len(pruned); got != 2 {
		t.Fatalf("snapshot count after universe prune=%d want HPG plus impact (2)", got)
	}
	for _, frame := range pruned {
		if frame["T"] == "f" && frame["symbol"] != "HPG" {
			t.Fatalf("removed-universe frame survived pruning: %v", frame)
		}
	}

	bounded := newContextSnapshotBuffer("2026-10-05", 160)
	bounded.SetUniverse([]string{"HPG"})
	oversized := testForeignSnapshot("HPG", sourceTime)
	oversized["providerPayload"] = strings.Repeat("x", 512)
	if bounded.Push(oversized) || bounded.Len() != 0 || bounded.currentSize > 160 {
		t.Fatalf("oversized frame escaped byte bound: accepted len=%d accounted=%d", bounded.Len(), bounded.currentSize)
	}
}

func TestContextSnapshotBufferRequiresFullAmountsButAcceptsZeroAndEqualCorrections(t *testing.T) {
	sourceTime := testProviderSourceTime()
	buffer := newContextSnapshotBuffer("2026-10-05", maxContextSnapshotBytes)
	buffer.SetUniverse([]string{"HPG"})

	zeroAmount := testForeignSnapshot("HPG", sourceTime)
	zeroAmount["buyTradedAmount"] = float64(0)
	zeroAmount["totalBuyTradedAmount"] = float64(0)
	zeroAmount["sellTradedAmount"] = float64(0)
	zeroAmount["totalSellTradedAmount"] = float64(0)
	if !buffer.Push(zeroAmount) {
		t.Fatal("complete snapshot with genuine zero buy/sell amounts should be retained")
	}

	volumeOnly := testForeignSnapshot("HPG", sourceTime.Add(time.Second))
	delete(volumeOnly, "buyTradedAmount")
	delete(volumeOnly, "totalBuyTradedAmount")
	delete(volumeOnly, "sellTradedAmount")
	delete(volumeOnly, "totalSellTradedAmount")
	if buffer.Push(volumeOnly) {
		t.Fatal("volume-only frame must not count as a complete foreign value snapshot")
	}
	if got := buffer.Len(); got != 1 {
		t.Fatalf("volume-only frame replaced valid zero snapshot, len=%d want 1", got)
	}

	original := testForeignSnapshot("HPG", sourceTime.Add(2*time.Second))
	original["buyTradedAmount"] = float64(100)
	original["totalBuyTradedAmount"] = float64(100)
	if !buffer.Push(original) {
		t.Fatal("newer complete snapshot should replace the earlier source")
	}
	equalCorrection := testForeignSnapshot("HPG", sourceTime.Add(2*time.Second))
	equalCorrection["buyTradedAmount"] = float64(200)
	equalCorrection["totalBuyTradedAmount"] = float64(200)
	if !buffer.Accepts(equalCorrection) || !buffer.Push(equalCorrection) {
		t.Fatal("equal-asOf complete correction should be accepted")
	}
	older := testForeignSnapshot("HPG", sourceTime.Add(time.Second))
	if buffer.Accepts(older) {
		t.Fatal("older asOf frame must be rejected")
	}

	frames := buffer.Snapshot()
	if len(frames) != 1 || frames[0]["buyTradedAmount"] != float64(200) {
		t.Fatalf("snapshot after correction/older frame=%v want equal-asOf correction amount 200", frames)
	}
}

func TestCombineCheckpointFramesPreservesRetainedValuesAndIndexNameIdentity(t *testing.T) {
	sourceTime := testProviderSourceTime()
	retainedForeign := testForeignSnapshot("HPG", sourceTime)
	retainedForeign["buyTradedAmount"] = float64(100)
	retainedForeign["totalBuyTradedAmount"] = float64(100)
	retainedImpact := testIndexImpactFrame(sourceTime)
	originalAsOf := retainedImpact["providerAsOf"]

	newerVolumeOnly := testForeignSnapshot("HPG", sourceTime.Add(time.Second))
	delete(newerVolumeOnly, "buyTradedAmount")
	delete(newerVolumeOnly, "totalBuyTradedAmount")
	delete(newerVolumeOnly, "sellTradedAmount")
	delete(newerVolumeOnly, "totalSellTradedAmount")
	indexFrame := realtime.Frame{"T": "mi", "indexName": "VNINDEX", "indexValue": 1_234.5}

	merged := combineCheckpointFrames(
		[]realtime.Frame{newerVolumeOnly, indexFrame},
		[]realtime.Frame{retainedForeign, retainedImpact},
		maxRealtimePayloadBytes,
	)
	if got := len(merged); got != 3 {
		t.Fatalf("merged checkpoint frame count=%d want foreign, impact, and MI frames (3): %v", got, merged)
	}
	var gotForeign, gotImpact, gotIndex realtime.Frame
	for _, frame := range merged {
		switch frame["T"] {
		case "f":
			gotForeign = frame
		case "index-impact":
			gotImpact = frame
		case "mi":
			gotIndex = frame
		}
	}
	if gotForeign == nil || gotForeign["buyTradedAmount"] != float64(100) {
		t.Fatalf("newer incomplete frame displaced retained complete amounts: %v", gotForeign)
	}
	if gotImpact == nil || gotImpact["providerAsOf"] != originalAsOf {
		t.Fatalf("impact asOf changed or frame was dropped: got=%v want=%v", gotImpact, originalAsOf)
	}
	if gotIndex == nil || gotIndex["indexName"] != "VNINDEX" {
		t.Fatalf("MI frame keyed only by indexName was dropped: %v", gotIndex)
	}
}


func TestContextSnapshotBufferRetainsLatestVNINDEXForUnattendedDBSampling(t *testing.T) {
	sourceTime := testProviderSourceTime()
	buffer := newContextSnapshotBuffer("2026-10-05", maxContextSnapshotBytes)
	buffer.SetUniverse([]string{"HPG"})
	mi := realtime.Frame{
		"T": "mi", "indexName": "VNINDEX", "valueIndexes": float64(1740),
		"grossTradeAmount": float64(178.0548371), "totalVolumeTraded": float64(8861632),
		"transactTime": map[string]any{"Seconds": sourceTime.Unix(), "Nanos": sourceTime.Nanosecond()},
	}
	if !buffer.Accepts(mi) || !buffer.Push(mi) {
		t.Fatal("verified VNINDEX MI was not retained for recurring DB sampling")
	}
	if got := buffer.Len(); got != 1 {
		t.Fatalf("retained MI count=%d, want 1", got)
	}
	stale := cloneRealtimeFrame(mi)
	stale["transactTime"] = map[string]any{"Seconds": sourceTime.Add(-time.Second).Unix(), "Nanos": 0}
	if buffer.Accepts(stale) {
		t.Fatal("older index sample cannot replace current source time")
	}
	other := cloneRealtimeFrame(mi)
	other["indexName"] = "VN30"
	if buffer.Accepts(other) {
		t.Fatal("only VNINDEX can enter retained liquidity context")
	}
	newer := cloneRealtimeFrame(mi)
	newer["transactTime"] = map[string]any{"Seconds": sourceTime.Add(time.Second).Unix(), "Nanos": 0}
	newer["grossTradeAmount"] = float64(179)
	if !buffer.Accepts(newer) || !buffer.Push(newer) {
		t.Fatal("new provider value must advance unattended snapshot")
	}
	out := buffer.Snapshot()
	if len(out) != 1 || out[0]["grossTradeAmount"] != float64(179) {
		t.Fatalf("latest retained MI missing: %v", out)
	}
}
