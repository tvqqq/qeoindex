package relay

import (
	"testing"
)

func TestHubValidatesTopicsAndFansOut(t *testing.T) {
	hub := NewHub("epoch-1", 4, nil)
	hub.SetUniverse([]string{"MSN", "FPT"})
	client := hub.newClient("user-1", nil)
	hub.addClient(client)
	defer hub.removeClient(client)

	accepted, err := hub.Subscribe(client, []string{"market", "orderbook:msn"})
	if err != nil {
		t.Fatalf("Subscribe() error = %v", err)
	}
	if len(accepted) != 2 || accepted[1] != "orderbook:MSN" {
		t.Fatalf("accepted = %#v", accepted)
	}
	if _, err := hub.Subscribe(client, []string{"orderbook:AAA"}); err == nil {
		t.Fatal("expected non-universe symbol to be rejected")
	}

	hub.Publish("orderbook:MSN", map[string]any{"type": "orderbook"})
	select {
	case payload := <-client.send:
		if len(payload) == 0 {
			t.Fatal("expected payload")
		}
	default:
		t.Fatal("expected subscribed client to receive payload")
	}
}

func TestHubDisconnectsSlowConsumerWithoutBlockingPublisher(t *testing.T) {
	hub := NewHub("epoch-1", 1, nil)
	hub.SetUniverse([]string{"MSN"})
	slow := false
	client := hub.newClient("user-1", func() { slow = true })
	hub.addClient(client)
	if _, err := hub.Subscribe(client, []string{"market"}); err != nil {
		t.Fatal(err)
	}

	hub.Publish("market", map[string]any{"sequence": 1})
	hub.Publish("market", map[string]any{"sequence": 2})
	if !slow {
		t.Fatal("expected slow-consumer callback")
	}
	if stats := hub.Stats(); stats.Clients != 0 || stats.SlowConsumers != 1 {
		t.Fatalf("unexpected stats: %#v", stats)
	}
}

func TestHubUniverseRefreshRemovesInvalidSubscriptions(t *testing.T) {
	hub := NewHub("epoch-1", 4, nil)
	hub.SetUniverse([]string{"MSN"})
	client := hub.newClient("user-1", nil)
	hub.addClient(client)
	defer hub.removeClient(client)
	if _, err := hub.Subscribe(client, []string{"orderbook:MSN"}); err != nil {
		t.Fatal(err)
	}
	hub.SetUniverse([]string{"FPT"})
	if _, exists := client.topics["orderbook:MSN"]; exists {
		t.Fatal("stale symbol subscription survived universe refresh")
	}
}
