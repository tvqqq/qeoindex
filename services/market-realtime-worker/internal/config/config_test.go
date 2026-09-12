package config

import (
	"testing"
	"time"
)

func TestWindowUsesICTWeekdayBounds(t *testing.T) {
	loc, err := time.LoadLocation(MarketTimezone)
	if err != nil {
		t.Fatal(err)
	}
	cfg := Config{Location: loc}
	for _, tc := range []struct {
		at   string
		want bool
	}{
		{"2026-09-14T08:54:59+07:00", false},
		{"2026-09-14T08:55:00+07:00", true},
		{"2026-09-14T14:49:59+07:00", true},
		{"2026-09-14T14:50:00+07:00", false},
		{"2026-09-13T10:00:00+07:00", false},
	} {
		at, err := time.Parse(time.RFC3339, tc.at)
		if err != nil {
			t.Fatal(err)
		}
		_, _, got := cfg.Window(at)
		if got != tc.want {
			t.Fatalf("Window(%s)=%v want %v", tc.at, got, tc.want)
		}
	}
}

func TestStaleWatchSkipsPreopenAndLunch(t *testing.T) {
	loc, _ := time.LoadLocation(MarketTimezone)
	cfg := Config{Location: loc}
	for _, tc := range []struct {
		at   string
		want bool
	}{
		{"2026-09-14T08:58:00+07:00", false},
		{"2026-09-14T10:00:00+07:00", true},
		{"2026-09-14T12:00:00+07:00", false},
		{"2026-09-14T13:30:00+07:00", true},
	} {
		at, _ := time.Parse(time.RFC3339, tc.at)
		if got := cfg.StaleWatchActive(at); got != tc.want {
			t.Fatalf("StaleWatchActive(%s)=%v want %v", tc.at, got, tc.want)
		}
	}
}
