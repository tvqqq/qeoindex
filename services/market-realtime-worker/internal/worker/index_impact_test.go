package worker

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

const testIndexImpactPayload = `[
	{"symbol":"HDB","basketInfluence":-0.71623814,"time":{"seconds":1791169559,"nanos":629508980}},
	{"symbol":"TCB","basketInfluence":-0.5975458,"time":{"seconds":1791169566,"nanos":519798784}},
	{"symbol":"VHM","basketInfluence":-0.37784365,"time":{"seconds":1791169554,"nanos":161062884}},
	{"symbol":"PNJ","basketInfluence":-0.2824419,"time":{"seconds":1791169563,"nanos":481427069}}
]`

func TestParseIndexImpactFrameNormalizesProviderRowsAndEnforcesBounds(t *testing.T) {
	frame, err := parseIndexImpactFrame([]byte(testIndexImpactPayload), maxIndexImpactRows)
	if err != nil {
		t.Fatalf("parse valid provider impact sample: %v", err)
	}
	if frame["T"] != "index-impact" || frame["symbol"] != "VNINDEX" {
		t.Fatalf("normalized frame identity=(%v,%v), want (index-impact,VNINDEX)", frame["T"], frame["symbol"])
	}
	rows, ok := frame["rows"].([]map[string]any)
	if !ok || len(rows) != 4 {
		t.Fatalf("normalized rows=%T %v, want 4 rows", frame["rows"], frame["rows"])
	}
	gotSymbols := make([]string, 0, len(rows))
	for _, row := range rows {
		gotSymbols = append(gotSymbols, row["symbol"].(string))
		influence, ok := row["basketInfluence"].(float64)
		if !ok || !finite(influence) {
			t.Fatalf("non-finite or non-numeric contribution in row %v", row)
		}
		providerTime, ok := row["time"].(map[string]any)
		if !ok {
			t.Fatalf("normalized row has no time object: %v", row)
		}
		if _, valid := parseProviderImpactTime(providerTime); !valid {
			t.Fatalf("normalized provider time is invalid: %v", providerTime)
		}
	}
	wantSymbols := []string{"HDB", "PNJ", "TCB", "VHM"}
	for index, symbol := range wantSymbols {
		if gotSymbols[index] != symbol {
			t.Fatalf("normalized symbol order=%v want %v", gotSymbols, wantSymbols)
		}
	}
	wantAsOf := time.Unix(1791169566, 519798784).UTC().Format(time.RFC3339Nano)
	if frame["providerAsOf"] != wantAsOf {
		t.Fatalf("providerAsOf=%v want latest row time %s", frame["providerAsOf"], wantAsOf)
	}

	if _, err := parseIndexImpactFrame([]byte("{"), maxIndexImpactRows); err == nil {
		t.Fatal("malformed provider JSON should be rejected")
	}
	if _, err := parseIndexImpactFrame([]byte(testIndexImpactPayload), 3); err == nil {
		t.Fatal("provider row count above the caller bound should be rejected")
	}
	if _, err := parseIndexImpactFrame([]byte(`[{"symbol":"?","basketInfluence":"NaN","time":{}}]`), maxIndexImpactRows); err == nil {
		t.Fatal("payload with no valid finite timestamped contribution should be rejected")
	}
}

func TestFetchIndexImpactHonorsRequestTimeoutAndCallerCancellation(t *testing.T) {
	started := make(chan struct{}, 2)
	finished := make(chan struct{}, 2)
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		started <- struct{}{}
		<-request.Context().Done()
		finished <- struct{}{}
	}))
	defer server.Close()

	if _, err := fetchIndexImpact(context.Background(), &http.Client{}, server.URL, 40*time.Millisecond); err == nil {
		t.Fatal("request should fail when the configured timeout expires")
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("timed request did not reach the test server")
	}
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("server handler did not observe request timeout cancellation")
	}

	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := fetchIndexImpact(ctx, &http.Client{}, server.URL, time.Second)
		result <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("caller-cancel request did not reach test server")
	}
	cancel()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("caller cancellation should fail the provider request")
		}
	case <-time.After(time.Second):
		t.Fatal("fetchIndexImpact did not return after caller cancellation")
	}
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("server handler did not observe caller cancellation")
	}
}

func TestRunIndexImpactPollerDoesNotOverlapAndStopsAfterCancellation(t *testing.T) {
	var active atomic.Int32
	var maxActive atomic.Int32
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		current := active.Add(1)
		defer active.Add(-1)
		for {
			previous := maxActive.Load()
			if current <= previous || maxActive.CompareAndSwap(previous, current) {
				break
			}
		}
		requests.Add(1)
		timer := time.NewTimer(20 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-request.Context().Done():
			return
		case <-timer.C:
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(response, testIndexImpactPayload)
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	published := make(chan map[string]any, 4)
	done := make(chan struct{})
	go func() {
		defer close(done)
		runIndexImpactPoller(ctx, nil, func(frame map[string]any) {
			published <- frame
		}, server.URL, time.Millisecond, 300*time.Millisecond)
	}()

	for count := 0; count < 3; count++ {
		select {
		case frame := <-published:
			if frame["T"] != "index-impact" {
				t.Fatalf("poller published unexpected frame: %v", frame)
			}
		case <-time.After(time.Second):
			cancel()
			<-done
			t.Fatalf("poller published only %d frames", count)
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("poller did not stop after cancellation")
	}
	if got := maxActive.Load(); got != 1 {
		t.Fatalf("overlapping provider requests observed: max active=%d want 1", got)
	}
	if got := requests.Load(); got < 3 {
		t.Fatalf("provider request count=%d want at least 3", got)
	}
}
