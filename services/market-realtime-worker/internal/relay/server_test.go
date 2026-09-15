package relay

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestRelayServerRejectsDisallowedOrigin(t *testing.T) {
	hub := NewHub("epoch-1", 8, nil)
	server := NewServer(ServerConfig{SigningSecret: "secret", AllowedOrigins: []string{"https://app.example"}, AuthTimeout: time.Second, PingInterval: time.Second}, hub, nil)
	httpServer := httptest.NewServer(http.HandlerFunc(server.handleWebSocket))
	defer httpServer.Close()

	header := http.Header{}
	header.Set("Origin", "https://evil.example")
	conn, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(httpServer.URL, "http"), header)
	if conn != nil {
		_ = conn.Close()
	}
	if err == nil {
		t.Fatal("expected disallowed origin to fail")
	}
	if response == nil || response.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %#v, want 403", response)
	}
}

func TestRelayServerAuthenticatesBeforeSubscription(t *testing.T) {
	now := time.Now()
	hub := NewHub("epoch-1", 8, nil)
	hub.SetUniverse([]string{"MSN"})
	server := NewServer(ServerConfig{SigningSecret: "secret", AllowedOrigins: []string{"https://app.example"}, AuthTimeout: time.Second, PingInterval: time.Second}, hub, nil)
	httpServer := httptest.NewServer(http.HandlerFunc(server.handleWebSocket))
	defer httpServer.Close()

	header := http.Header{}
	header.Set("Origin", "https://app.example")
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(httpServer.URL, "http"), header)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	claims := Claims{Version: 1, Subject: "user-1", Audience: TokenAudience, IssuedAt: now.Unix(), ExpiresAt: now.Add(60 * time.Second).Unix()}
	if err := conn.WriteJSON(clientMessage{Type: "auth", Token: signTestToken(t, claims, "secret")}); err != nil {
		t.Fatal(err)
	}
	var ready readyMessage
	if err := conn.ReadJSON(&ready); err != nil {
		t.Fatal(err)
	}
	if ready.Type != "ready" || ready.Protocol != 1 || ready.Epoch != "epoch-1" {
		t.Fatalf("unexpected ready: %#v", ready)
	}

	if err := conn.WriteJSON(clientMessage{Type: "subscribe", Topics: []string{"market", "orderbook:MSN"}}); err != nil {
		t.Fatal(err)
	}
	var subscribed subscribedMessage
	if err := conn.ReadJSON(&subscribed); err != nil {
		t.Fatal(err)
	}
	if subscribed.Type != "subscribed" || len(subscribed.Topics) != 2 {
		t.Fatalf("unexpected subscription ack: %#v", subscribed)
	}
}

func TestRelayServerRejectsSubscriptionBeforeAuth(t *testing.T) {
	hub := NewHub("epoch-1", 8, nil)
	server := NewServer(ServerConfig{SigningSecret: "secret", AllowedOrigins: []string{"https://app.example"}, AuthTimeout: time.Second, PingInterval: time.Second}, hub, nil)
	httpServer := httptest.NewServer(http.HandlerFunc(server.handleWebSocket))
	defer httpServer.Close()

	header := http.Header{}
	header.Set("Origin", "https://app.example")
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(httpServer.URL, "http"), header)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.WriteJSON(clientMessage{Type: "subscribe", Topics: []string{"market"}}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("expected unauthenticated subscription to close")
	}
}
