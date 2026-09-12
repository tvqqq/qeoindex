package dnse

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/dnseauth"
)

type Channel struct {
	Name    string   `json:"name"`
	Symbols []string `json:"symbols,omitempty"`
}

type Stream struct {
	Name        string
	URL         string
	Auth        dnseauth.Auth
	Channels    []Channel
	OnFrame     func(map[string]any)
	Logger      *slog.Logger
	PingEvery   time.Duration
	StaleAfter  time.Duration
	StaleActive func(time.Time) bool
}

func StockChannels(tickers []string) []Channel {
	return []Channel{{Name: "tick.G1.json", Symbols: append([]string(nil), tickers...)}}
}

func IndexChannels() []Channel {
	return []Channel{
		{Name: "market_index.VNINDEX.json"},
		{Name: "market_index.VN30.json"},
		{Name: "market_index.HNX.json"},
		{Name: "market_index.UPCOM.json"},
	}
}

type backoff struct{ attempt int }

func (b *backoff) Reset() { b.attempt = 0 }
func (b *backoff) Next() time.Duration {
	b.attempt++
	exponent := b.attempt - 1
	if exponent > 4 {
		exponent = 4
	}
	base := 750 * time.Millisecond * time.Duration(1<<exponent)
	if base > 10*time.Second {
		base = 10 * time.Second
	}
	return base + time.Duration(rand.Intn(500))*time.Millisecond
}

func (s *Stream) Run(ctx context.Context) error {
	if s.OnFrame == nil {
		return errors.New("DNSE stream OnFrame callback is required")
	}
	if s.Logger == nil {
		s.Logger = slog.Default()
	}
	if s.PingEvery <= 0 {
		s.PingEvery = 15 * time.Second
	}
	if s.StaleAfter <= 0 {
		s.StaleAfter = 60 * time.Second
	}
	if s.StaleActive == nil {
		s.StaleActive = func(time.Time) bool { return true }
	}

	var retry backoff
	for {
		authenticated, err := s.runOnce(ctx)
		if ctx.Err() != nil {
			return nil
		}
		if authenticated {
			retry.Reset()
		}
		delay := retry.Next()
		s.Logger.Warn("dnse_reconnect_scheduled", "stream", s.Name, "delay_ms", delay.Milliseconds(), "error", errString(err))
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}

func (s *Stream) runOnce(ctx context.Context) (bool, error) {
	conn, response, err := websocket.DefaultDialer.DialContext(ctx, s.URL, nil)
	if response != nil && response.Body != nil {
		_ = response.Body.Close()
	}
	if err != nil {
		return false, fmt.Errorf("dial DNSE websocket: %w", err)
	}
	defer conn.Close()

	var writeMu sync.Mutex
	writeJSON := func(value any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		return conn.WriteJSON(value)
	}

	var lastFrameUnixNano atomic.Int64
	lastFrameUnixNano.Store(time.Now().UnixNano())
	watchDone := make(chan struct{})
	defer close(watchDone)

	go func() {
		pingTicker := time.NewTicker(s.PingEvery)
		staleTicker := time.NewTicker(10 * time.Second)
		defer pingTicker.Stop()
		defer staleTicker.Stop()
		for {
			select {
			case <-watchDone:
				return
			case <-ctx.Done():
				writeMu.Lock()
				_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "shutdown"), time.Now().Add(2*time.Second))
				writeMu.Unlock()
				_ = conn.Close()
				return
			case <-pingTicker.C:
				if err := writeJSON(map[string]any{"action": "ping", "timestamp": time.Now().UnixMilli()}); err != nil {
					s.Logger.Warn("dnse_ping_failed", "stream", s.Name, "error", err.Error())
					_ = conn.Close()
					return
				}
			case now := <-staleTicker.C:
				if !s.StaleActive(now) {
					continue
				}
				lastFrame := time.Unix(0, lastFrameUnixNano.Load())
				if now.Sub(lastFrame) > s.StaleAfter {
					s.Logger.Warn("dnse_stale_stream", "stream", s.Name, "stale_ms", now.Sub(lastFrame).Milliseconds())
					_ = conn.Close()
					return
				}
			}
		}
	}()

	authenticated := false
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return authenticated, fmt.Errorf("read DNSE websocket: %w", err)
		}
		data, err := decodeMessage(raw)
		if err != nil {
			continue
		}
		action := stringValue(data["action"])
		if action == "" {
			action = stringValue(data["a"])
		}
		switch {
		case action == "ping":
			if err := writeJSON(map[string]any{"action": "pong", "timestamp": data["timestamp"]}); err != nil {
				return authenticated, fmt.Errorf("write DNSE pong: %w", err)
			}
		case action == "welcome" || data["session_id"] != nil || data["sid"] != nil:
			payload, err := s.Auth.Payload(time.Now())
			if err != nil {
				return authenticated, fmt.Errorf("build DNSE auth payload: %w", err)
			}
			if err := writeJSON(payload); err != nil {
				return authenticated, fmt.Errorf("write DNSE auth payload: %w", err)
			}
		case action == "auth_success":
			if err := writeJSON(map[string]any{"action": "subscribe", "channels": s.Channels}); err != nil {
				return authenticated, fmt.Errorf("write DNSE subscription: %w", err)
			}
			authenticated = true
			lastFrameUnixNano.Store(time.Now().UnixNano())
			s.Logger.Info("dnse_subscribed", "stream", s.Name, "channels", len(s.Channels))
		case action == "auth_error" || action == "error":
			message := stringValue(data["message"])
			if message == "" {
				message = stringValue(data["msg"])
			}
			return authenticated, fmt.Errorf("DNSE %s: %s", action, message)
		default:
			if stringValue(data["T"]) != "" {
				lastFrameUnixNano.Store(time.Now().UnixNano())
				s.OnFrame(data)
			}
		}
	}
}

func errString(err error) string {
	if err == nil {
		return "unknown"
	}
	return err.Error()
}
