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
