package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	MarketTimezone = "Asia/Ho_Chi_Minh"
	MarketOpen     = "08:55"
	MarketClose    = "14:50"
)

type Config struct {
	DNSEAPIKey                   string
	DNSEAPISecret                string
	DNSEWSURL                    string
	SupabaseURL                  string
	SupabaseServiceRoleKey       string
	FlushInterval                time.Duration
	OrderbookFlushInterval       time.Duration
	OrderbookMaxPayloadBytes     int
	OrderbookMaxExecutionFrames  int
	UniverseRefreshInterval      time.Duration
	PingInterval                 time.Duration
	StaleAfter                   time.Duration
	RelayListenAddr              string
	RelaySigningSecret           string
	RelayAllowedOrigins          []string
	RelayAuthTimeout             time.Duration
	RelayPingInterval            time.Duration
	RelaySendQueue               int
	RelayMarketFlushInterval     time.Duration
	RelayOrderbookFlushInterval  time.Duration
	Location                     *time.Location
}

func Load() (Config, error) {
	loc, err := time.LoadLocation(MarketTimezone)
	if err != nil {
		return Config{}, fmt.Errorf("load market timezone: %w", err)
	}
	cfg := Config{
		DNSEAPIKey:                  strings.TrimSpace(os.Getenv("DNSE_API_KEY")),
		DNSEAPISecret:               strings.TrimSpace(os.Getenv("DNSE_API_SECRET")),
		DNSEWSURL:                   strings.TrimSpace(os.Getenv("DNSE_WS_URL")),
		SupabaseURL:                 strings.TrimRight(strings.TrimSpace(os.Getenv("SUPABASE_URL")), "/"),
		SupabaseServiceRoleKey:      strings.TrimSpace(os.Getenv("SUPABASE_SERVICE_ROLE_KEY")),
		FlushInterval:               durationMS("MARKET_REALTIME_FLUSH_MS", 1000, 250, 5000),
		OrderbookFlushInterval:      durationMS("ORDERBOOK_REALTIME_FLUSH_MS", 500, 250, 2000),
		OrderbookMaxPayloadBytes:    boundedInt("ORDERBOOK_REALTIME_MAX_PAYLOAD_BYTES", 196608, 65536, 262144),
		OrderbookMaxExecutionFrames: boundedInt("ORDERBOOK_REALTIME_MAX_EXECUTION_FRAMES", 2000, 100, 10000),
		UniverseRefreshInterval:     durationMS("MARKET_UNIVERSE_REFRESH_MS", 300000, 60000, 1800000),
		PingInterval:                durationMS("MARKET_REALTIME_PING_MS", 15000, 5000, 60000),
		StaleAfter:                  durationMS("MARKET_REALTIME_STALE_MS", 60000, 15000, 300000),
		RelayListenAddr:             envOrDefault("QEO_MARKET_REALTIME_LISTEN_ADDR", ":8787"),
		RelaySigningSecret:          strings.TrimSpace(os.Getenv("QEO_MARKET_REALTIME_SIGNING_SECRET")),
		RelayAllowedOrigins:         commaList(os.Getenv("QEO_MARKET_REALTIME_ALLOWED_ORIGINS")),
		RelayAuthTimeout:            durationMS("QEO_MARKET_REALTIME_AUTH_TIMEOUT_MS", 5000, 1000, 15000),
		RelayPingInterval:           durationMS("QEO_MARKET_REALTIME_PING_MS", 15000, 5000, 60000),
		RelaySendQueue:              boundedInt("QEO_MARKET_REALTIME_SEND_QUEUE", 64, 8, 1024),
		RelayMarketFlushInterval:    durationMS("QEO_MARKET_REALTIME_MARKET_FLUSH_MS", 100, 25, 1000),
		RelayOrderbookFlushInterval: durationMS("QEO_MARKET_REALTIME_ORDERBOOK_FLUSH_MS", 50, 20, 1000),
		Location:                    loc,
	}
	if cfg.DNSEWSURL == "" {
		cfg.DNSEWSURL = "wss://ws-openapi.dnse.com.vn/v1/stream?encoding=json"
	}
	if cfg.DNSEAPIKey == "" || cfg.DNSEAPISecret == "" {
		return Config{}, errors.New("DNSE_API_KEY and DNSE_API_SECRET are required")
	}
	if cfg.SupabaseURL == "" || cfg.SupabaseServiceRoleKey == "" {
		return Config{}, errors.New("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
	}
	if cfg.RelaySigningSecret == "" {
		return Config{}, errors.New("QEO_MARKET_REALTIME_SIGNING_SECRET is required")
	}
	if len(cfg.RelayAllowedOrigins) == 0 {
		return Config{}, errors.New("QEO_MARKET_REALTIME_ALLOWED_ORIGINS is required")
	}
	for _, origin := range cfg.RelayAllowedOrigins {
		if origin == "*" {
			return Config{}, errors.New("QEO_MARKET_REALTIME_ALLOWED_ORIGINS cannot contain wildcard origin")
		}
	}
	return cfg, nil
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func commaList(raw string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0)
	for _, item := range strings.Split(raw, ",") {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func durationMS(name string, fallback, min, max int64) time.Duration {
	value := fallback
	if raw := strings.TrimSpace(os.Getenv(name)); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
			value = parsed
		}
	}
	if value < min {
		value = min
	}
	if value > max {
		value = max
	}
	return time.Duration(value) * time.Millisecond
}

func boundedInt(name string, fallback, min, max int) int {
	value := fallback
	if raw := strings.TrimSpace(os.Getenv(name)); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			value = parsed
		}
	}
	if value < min {
		value = min
	}
	if value > max {
		value = max
	}
	return value
}

func (c Config) Window(now time.Time) (time.Time, time.Time, bool) {
	local := now.In(c.Location)
	if local.Weekday() == time.Saturday || local.Weekday() == time.Sunday {
		return time.Time{}, time.Time{}, false
	}
	start := time.Date(local.Year(), local.Month(), local.Day(), 8, 55, 0, 0, c.Location)
	end := time.Date(local.Year(), local.Month(), local.Day(), 14, 50, 0, 0, c.Location)
	active := !local.Before(start) && local.Before(end)
	return start, end, active
}

func (c Config) StaleWatchActive(now time.Time) bool {
	local := now.In(c.Location)
	if local.Weekday() == time.Saturday || local.Weekday() == time.Sunday {
		return false
	}
	minutes := local.Hour()*60 + local.Minute()
	morning := minutes >= 9*60 && minutes < 11*60+30
	afternoon := minutes >= 13*60 && minutes < 14*60+50
	return morning || afternoon
}
