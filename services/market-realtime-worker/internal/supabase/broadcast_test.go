package supabase

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPublishPrivateBroadcastUsesRealtimeBatchEndpoint(t *testing.T) {
	var gotPath, gotAPIKey, gotContentType string
	var gotBody struct {
		Messages []struct {
			Topic   string         `json:"topic"`
			Event   string         `json:"event"`
			Payload map[string]any `json:"payload"`
		} `json:"messages"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
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

	if gotPath != "/realtime/v1/api/broadcast" {
		t.Fatalf("unexpected path %q", gotPath)
	}
	if gotAPIKey != "service-key" {
		t.Fatalf("unexpected apikey %q", gotAPIKey)
	}
	if gotContentType != "application/json" {
		t.Fatalf("unexpected content type %q", gotContentType)
	}
	if len(gotBody.Messages) != 1 {
		t.Fatalf("expected one broadcast message, got %#v", gotBody.Messages)
	}
	message := gotBody.Messages[0]
	if message.Topic != "orderbook:v1:04" || message.Event != "orderbook" {
		t.Fatalf("unexpected topic/event %#v", message)
	}
	if message.Payload["version"] != float64(1) || message.Payload["sequence"] != float64(7) {
		t.Fatalf("unexpected payload %#v", message.Payload)
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
