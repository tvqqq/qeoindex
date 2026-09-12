package realtime

import "time"

func NextSequence(last int64, now time.Time) int64 {
	next := now.UnixMilli()
	if next <= last {
		return last + 1
	}
	return next
}
