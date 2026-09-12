package realtime

import (
	"testing"
	"time"
)

func TestNextSequenceIsStrictlyMonotonic(t *testing.T) {
	now := time.UnixMilli(1000)
	if got := NextSequence(2000, now); got != 2001 {
		t.Fatalf("got %d", got)
	}
	if got := NextSequence(10, now); got != 1000 {
		t.Fatalf("got %d", got)
	}
}
