package supabase

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPublishPrivateBroadcastUsesScopedRealtimeEndpoint(t *testing.T) {
	var gotPath, gotQuery, gotAPIKey, gotContentType string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		gotAPIKey = r.Header.Get("apikey")
		gotContentType = r.Header.Get("Content-Type")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	client := New(server.URL, "service-key")
	payload := map[string]any{"version": 1, "sequence": 7}
	if err := client.PublishPrivateBroadcast(context.Background(), "orderbook:v1:04", "orderbook", payload); err != nil {
		t.Fatalf("PublishPrivateBroadcast: %v", err)
	}

	if gotPath != "/realtime/v1/api/broadcast/orderbook:v1:04/events/orderbook" {
		t.Fatalf("unexpected path %q", gotPath)
	}
	if gotQuery != "private=true" {
		t.Fatalf("unexpected query %q", gotQuery)
	}
	if gotAPIKey != "service-key" {
		t.Fatalf("unexpected apikey %q", gotAPIKey)
	}
	if gotContentType != "application/json" {
		t.Fatalf("unexpected content type %q", gotContentType)
	}
	if gotBody["version"] != float64(1) || gotBody["sequence"] != float64(7) {
		t.Fatalf("unexpected payload %#v", gotBody)
	}
}

func TestPublishPrivateBroadcastReturnsErrorOnRateLimit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	client := New(server.URL, "service-key")
	if err := client.PublishPrivateBroadcast(context.Background(), "orderbook:v1:04", "orderbook", map[string]any{"version": 1}); err == nil {
		t.Fatal("expected 429 to surface as publish error")
	}
}
