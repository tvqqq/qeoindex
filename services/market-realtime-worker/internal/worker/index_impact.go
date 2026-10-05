package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	indexImpactURL            = "https://api.dnse.com.vn/market-api/basket-influence?type=VNINDEX"
	indexImpactPollInterval   = 12 * time.Second
	indexImpactRequestTimeout = 4 * time.Second
	maxIndexImpactBodyBytes   = 256 * 1024
	maxIndexImpactRows        = 500
)

var impactSymbolPattern = regexp.MustCompile(`^[A-Z0-9]{2,12}$`)

type providerImpactTime struct {
	Seconds int64
	Nanos   int64
	UnixMS  int64
}

func (providerTime providerImpactTime) asOf() (time.Time, bool) {
	if providerTime.UnixMS > 0 {
		return time.UnixMilli(providerTime.UnixMS).UTC(), true
	}
	if providerTime.Seconds <= 0 || providerTime.Nanos < 0 || providerTime.Nanos >= int64(time.Second) {
		return time.Time{}, false
	}
	return time.Unix(providerTime.Seconds, providerTime.Nanos).UTC(), true
}

func parseProviderImpactTime(value any) (providerImpactTime, bool) {
	switch typed := value.(type) {
	case json.Number:
		number, err := typed.Float64()
		if err != nil || !finite(number) || number <= 0 {
			return providerImpactTime{}, false
		}
		if number > 10_000_000_000 {
			return providerImpactTime{UnixMS: int64(number)}, true
		}
		seconds := int64(number)
		nanos := int64((number - float64(seconds)) * float64(time.Second))
		return providerImpactTime{Seconds: seconds, Nanos: nanos}, true
	case float64:
		return parseProviderImpactTime(json.Number(strconv.FormatFloat(typed, 'f', -1, 64)))
	case map[string]any:
		seconds, ok := integerField(typed, "seconds", "Seconds")
		if !ok {
			return providerImpactTime{}, false
		}
		nanos, ok := integerField(typed, "nanos", "Nanos")
		if !ok {
			nanos = 0
		}
		candidate := providerImpactTime{Seconds: seconds, Nanos: nanos}
		_, valid := candidate.asOf()
		return candidate, valid
	case string:
		parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(typed))
		if err != nil {
			return providerImpactTime{}, false
		}
		return providerImpactTime{Seconds: parsed.Unix(), Nanos: int64(parsed.Nanosecond())}, true
	default:
		return providerImpactTime{}, false
	}
}

func integerField(data map[string]any, keys ...string) (int64, bool) {
	for _, key := range keys {
		value, exists := data[key]
		if !exists || value == nil {
			continue
		}
		switch typed := value.(type) {
		case json.Number:
			parsed, err := typed.Int64()
			if err == nil {
				return parsed, true
			}
		case float64:
			if finite(typed) && math.Trunc(typed) == typed && typed >= math.MinInt64 && typed <= math.MaxInt64 {
				return int64(typed), true
			}
		case int:
			return int64(typed), true
		case int32:
			return int64(typed), true
		case int64:
			return typed, true
		case uint:
			if uint64(typed) <= math.MaxInt64 {
				return int64(typed), true
			}
		case uint32:
			return int64(typed), true
		case uint64:
			if typed <= math.MaxInt64 {
				return int64(typed), true
			}
		case string:
			parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
			if err == nil {
				return parsed, true
			}
		}
		return 0, false
	}
	return 0, false
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func impactRows(payload any) ([]any, bool) {
	if rows, ok := payload.([]any); ok {
		return rows, true
	}
	object, ok := payload.(map[string]any)
	if !ok {
		return nil, false
	}
	for _, key := range []string{"rows", "data", "result", "items"} {
		if rows, ok := object[key].([]any); ok {
			return rows, true
		}
	}
	return nil, false
}

func impactNumber(value any) (float64, bool) {
	var parsed float64
	switch typed := value.(type) {
	case json.Number:
		var err error
		parsed, err = typed.Float64()
		if err != nil {
			return 0, false
		}
	case float64:
		parsed = typed
	case string:
		var err error
		parsed, err = strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err != nil {
			return 0, false
		}
	default:
		return 0, false
	}
	return parsed, finite(parsed)
}

func parseIndexImpactFrame(payload []byte, maxRows int) (map[string]any, error) {
	if maxRows <= 0 {
		maxRows = maxIndexImpactRows
	}
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		return nil, fmt.Errorf("decode provider JSON")
	}
	rows, ok := impactRows(decoded)
	if !ok || len(rows) == 0 || len(rows) > maxRows {
		return nil, fmt.Errorf("provider row count outside bounds")
	}

	cleanRows := make([]map[string]any, 0, len(rows))
	latest := time.Time{}
	for _, rawRow := range rows {
		row, ok := rawRow.(map[string]any)
		if !ok {
			continue
		}
		symbol := strings.ToUpper(strings.TrimSpace(fmt.Sprint(row["symbol"])))
		contribution, contributionOK := impactNumber(row["basketInfluence"])
		providerTime, timeOK := parseProviderImpactTime(row["time"])
		providerAsOf, asOfOK := providerTime.asOf()
		if !impactSymbolPattern.MatchString(symbol) || !contributionOK || !timeOK || !asOfOK {
			continue
		}
		if providerAsOf.After(latest) {
			latest = providerAsOf
		}
		cleanRows = append(cleanRows, map[string]any{
			"symbol":          symbol,
			"basketInfluence": contribution,
			"time": map[string]any{
				"seconds": providerAsOf.Unix(),
				"nanos":   providerAsOf.Nanosecond(),
			},
		})
	}
	if len(cleanRows) == 0 || latest.IsZero() {
		return nil, fmt.Errorf("provider returned no finite timestamped contributions")
	}
	sort.SliceStable(cleanRows, func(i, j int) bool {
		return cleanRows[i]["symbol"].(string) < cleanRows[j]["symbol"].(string)
	})
	return map[string]any{
		"T":            "index-impact",
		"symbol":       "VNINDEX",
		"rows":         cleanRows,
		"providerAsOf": latest.UTC().Format(time.RFC3339Nano),
	}, nil
}

func fetchIndexImpact(ctx context.Context, client *http.Client, endpoint string, timeout time.Duration) (map[string]any, error) {
	if timeout <= 0 {
		timeout = indexImpactRequestTimeout
	}
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build provider request")
	}
	request.Header.Set("Accept", "application/json, text/plain, */*")
	request.Header.Set("Origin", "https://banggia.dnse.com.vn")
	request.Header.Set("Referer", "https://banggia.dnse.com.vn/")
	request.Header.Set("User-Agent", "Mozilla/5.0 QeoIndex/1.0")

	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("provider request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("provider returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxIndexImpactBodyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read provider response")
	}
	if len(body) > maxIndexImpactBodyBytes {
		return nil, fmt.Errorf("provider response exceeded byte limit")
	}
	return parseIndexImpactFrame(body, maxIndexImpactRows)
}

func runIndexImpactPoller(ctx context.Context, logger *slog.Logger, publish func(map[string]any), endpoint string, interval, timeout time.Duration) {
	if logger == nil {
		logger = slog.Default()
	}
	if publish == nil {
		return
	}
	if interval <= 0 {
		interval = indexImpactPollInterval
	}
	if timeout <= 0 {
		timeout = indexImpactRequestTimeout
	}
	client := &http.Client{}
	for {
		if ctx.Err() != nil {
			return
		}
		frame, err := fetchIndexImpact(ctx, client, endpoint, timeout)
		if err != nil {
			if ctx.Err() == nil {
				logger.Warn("vnindex_impact_poll_failed", "error", err.Error())
			}
		} else {
			publish(frame)
		}

		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
