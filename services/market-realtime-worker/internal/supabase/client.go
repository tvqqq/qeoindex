package supabase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	key     string
	http    *http.Client
}

func New(baseURL, serviceRoleKey string) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), key: serviceRoleKey, http: &http.Client{Timeout: 10 * time.Second}}
}

func (c *Client) Universe(ctx context.Context) ([]string, error) {
	body, _ := json.Marshal(map[string]string{"p_universe_key": "vn_top_stocks"})
	var payload struct {
		Stocks []struct {
			Ticker string `json:"ticker"`
		} `json:"stocks"`
	}
	if err := c.doJSON(ctx, http.MethodPost, "/rest/v1/rpc/qeo_current_market_universe", body, "", &payload); err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	tickers := make([]string, 0, len(payload.Stocks))
	for _, stock := range payload.Stocks {
		ticker := strings.ToUpper(strings.TrimSpace(stock.Ticker))
		if !validTicker(ticker) {
			continue
		}
		if _, exists := seen[ticker]; exists {
			continue
		}
		seen[ticker] = struct{}{}
		tickers = append(tickers, ticker)
		if len(tickers) == 200 {
			break
		}
	}
	if len(tickers) == 0 {
		return nil, fmt.Errorf("canonical vn_top_stocks universe is empty")
	}
	return tickers, nil
}

func (c *Client) CurrentSequence(ctx context.Context) (int64, error) {
	query := url.Values{}
	query.Set("select", "sequence")
	query.Set("stream", "eq.dnse-market")
	query.Set("limit", "1")
	var rows []struct {
		Sequence int64 `json:"sequence"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/rest/v1/market_realtime_bus?"+query.Encode(), nil, "", &rows); err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}
	return rows[0].Sequence, nil
}

func (c *Client) Publish(ctx context.Context, sequence int64, frames []map[string]any) error {
	if len(frames) == 0 {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	body, err := json.Marshal(map[string]any{
		"stream":            "dnse-market",
		"sequence":          sequence,
		"provider":          "DNSE",
		"frames":            frames,
		"source_updated_at": now,
		"updated_at":        now,
	})
	if err != nil {
		return fmt.Errorf("encode realtime bus payload: %w", err)
	}
	return c.doJSON(ctx, http.MethodPost, "/rest/v1/market_realtime_bus?on_conflict=stream", body, "resolution=merge-duplicates,return=minimal", nil)
}

func (c *Client) doJSON(ctx context.Context, method, path string, body []byte, prefer string, out any) error {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", c.key)
	req.Header.Set("Authorization", "Bearer "+c.key)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if prefer != "" {
		req.Header.Set("Prefer", prefer)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("Supabase request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Supabase request failed with status %d", response.StatusCode)
	}
	if out == nil || response.StatusCode == http.StatusNoContent {
		_, _ = io.Copy(io.Discard, response.Body)
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(out); err != nil {
		return fmt.Errorf("decode Supabase response: %w", err)
	}
	return nil
}

func validTicker(ticker string) bool {
	if len(ticker) < 2 || len(ticker) > 12 {
		return false
	}
	for _, ch := range ticker {
		if (ch < 'A' || ch > 'Z') && (ch < '0' || ch > '9') {
			return false
		}
	}
	return true
}

func SameUniverse(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	a := append([]string(nil), left...)
	b := append([]string(nil), right...)
	sort.Strings(a)
	sort.Strings(b)
	for index := range a {
		if a[index] != b[index] {
			return false
		}
	}
	return true
}
