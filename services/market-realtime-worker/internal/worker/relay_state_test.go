package worker

import "testing"

func TestOrderbookRelayStateSequencesAndContinuityArePerSymbol(t *testing.T) {
	state := newOrderbookRelayState([]string{"MSN", "VCB"})
	state.MarkContinuityGapAll()

	sequence, gap, ok := state.Next("MSN")
	if !ok || sequence != 1 || !gap {
		t.Fatalf("first MSN state = (%d, %v, %v), want (1, true, true)", sequence, gap, ok)
	}
	sequence, gap, ok = state.Next("MSN")
	if !ok || sequence != 2 || gap {
		t.Fatalf("second MSN state = (%d, %v, %v), want (2, false, true)", sequence, gap, ok)
	}

	sequence, gap, ok = state.Next("VCB")
	if !ok || sequence != 1 || !gap {
		t.Fatalf("first VCB state = (%d, %v, %v), want (1, true, true)", sequence, gap, ok)
	}
}

func TestOrderbookRelayStateUniverseRefreshPrunesAndMarksNewSymbols(t *testing.T) {
	state := newOrderbookRelayState([]string{"MSN", "VCB"})
	state.MarkContinuityGapAll()
	_, _, _ = state.Next("MSN")

	state.SetUniverse([]string{"MSN", "FPT"})
	sequence, gap, ok := state.Next("MSN")
	if !ok || sequence != 2 || gap {
		t.Fatalf("existing MSN state = (%d, %v, %v), want (2, false, true)", sequence, gap, ok)
	}
	sequence, gap, ok = state.Next("FPT")
	if !ok || sequence != 1 || !gap {
		t.Fatalf("new FPT state = (%d, %v, %v), want (1, true, true)", sequence, gap, ok)
	}
	if _, _, ok = state.Next("VCB"); ok {
		t.Fatal("removed VCB must no longer receive relay sequence state")
	}
}
