package relay

import (
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	maxClientTopics           = 3
	relayPublishSampleEvery   int64 = 100
	relaySlowPublishThreshold       = 10 * time.Millisecond
)

type client struct {
	connectionID string
	subjectHash  string
	send         chan []byte
	done         chan struct{}
	topics       map[string]struct{}
	onSlow       func()
	once         sync.Once
}

func (c *client) stop() { c.once.Do(func() { close(c.done) }) }

type HubStats struct {
	Clients         int
	MarketTopics    int
	OrderbookTopics int
	SlowConsumers   int64
	Published       int64
	PublishedBytes  int64
}

type Hub struct {
	epoch     string
	sendQueue int
	logger    *slog.Logger

	mu       sync.RWMutex
	clients  map[*client]struct{}
	topics   map[string]map[*client]struct{}
	universe map[string]struct{}

	slowConsumers  atomic.Int64
	published      atomic.Int64
	publishedBytes atomic.Int64
}

func NewHub(epoch string, sendQueue int, logger *slog.Logger) *Hub {
	if sendQueue <= 0 {
		sendQueue = 64
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Hub{
		epoch:     epoch,
		sendQueue: sendQueue,
		logger:    logger,
		clients:   map[*client]struct{}{},
		topics:    map[string]map[*client]struct{}{},
		universe:  map[string]struct{}{},
	}
}

func (h *Hub) Epoch() string { return h.epoch }

func (h *Hub) SetUniverse(symbols []string) {
	next := make(map[string]struct{}, len(symbols))
	for _, symbol := range symbols {
		symbol = strings.ToUpper(strings.TrimSpace(symbol))
		if symbol != "" {
			next[symbol] = struct{}{}
		}
	}

	h.mu.Lock()
	h.universe = next
	for topic, subscribers := range h.topics {
		if topic == "market" || h.validTopicLocked(topic) {
			continue
		}
		for c := range subscribers {
			delete(c.topics, topic)
		}
		delete(h.topics, topic)
	}
	h.mu.Unlock()
}

func (h *Hub) newClient(connectionID, subjectHash string, onSlow func()) *client {
	return &client{
		connectionID: connectionID,
		subjectHash:  subjectHash,
		send:         make(chan []byte, h.sendQueue),
		done:         make(chan struct{}),
		topics:       map[string]struct{}{},
		onSlow:       onSlow,
	}
}

func (h *Hub) addClient(c *client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) removeClient(c *client) {
	h.mu.Lock()
	if _, exists := h.clients[c]; !exists {
		h.mu.Unlock()
		c.stop()
		return
	}
	delete(h.clients, c)
	for topic := range c.topics {
		if subscribers := h.topics[topic]; subscribers != nil {
			delete(subscribers, c)
			if len(subscribers) == 0 {
				delete(h.topics, topic)
			}
		}
	}
	c.topics = map[string]struct{}{}
	h.mu.Unlock()
	c.stop()
}

func (h *Hub) Subscribe(c *client, topics []string) ([]string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	normalized := make([]string, 0, len(topics))
	seen := make(map[string]struct{}, len(topics))
	newTopics := 0
	for _, raw := range topics {
		topic := normalizeTopic(raw)
		if topic == "" || !h.validTopicLocked(topic) {
			return nil, errors.New("invalid topic")
		}
		if _, duplicate := seen[topic]; duplicate {
			continue
		}
		seen[topic] = struct{}{}
		normalized = append(normalized, topic)
		if _, exists := c.topics[topic]; !exists {
			newTopics++
		}
	}
	if len(c.topics)+newTopics > maxClientTopics {
		return nil, errors.New("subscription limit exceeded")
	}

	accepted := make([]string, 0, len(normalized))
	for _, topic := range normalized {
		if _, exists := c.topics[topic]; exists {
			accepted = append(accepted, topic)
			continue
		}
		if h.topics[topic] == nil {
			h.topics[topic] = map[*client]struct{}{}
		}
		h.topics[topic][c] = struct{}{}
		c.topics[topic] = struct{}{}
		accepted = append(accepted, topic)
	}
	return accepted, nil
}

func (h *Hub) Unsubscribe(c *client, topics []string) []string {
	h.mu.Lock()
	defer h.mu.Unlock()

	removed := make([]string, 0, len(topics))
	for _, raw := range topics {
		topic := normalizeTopic(raw)
		if _, exists := c.topics[topic]; !exists {
			continue
		}
		delete(c.topics, topic)
		if subscribers := h.topics[topic]; subscribers != nil {
			delete(subscribers, c)
			if len(subscribers) == 0 {
				delete(h.topics, topic)
			}
		}
		removed = append(removed, topic)
	}
	return removed
}

func (h *Hub) Publish(topic string, message any) {
	started := time.Now()
	topic = normalizeTopic(topic)
	payload, err := json.Marshal(message)
	if err != nil {
		h.logger.Error("relay_encode_failed", "topic", topic, "error", err.Error())
		return
	}

	h.mu.RLock()
	subscribers := h.topics[topic]
	targets := make([]*client, 0, len(subscribers))
	for c := range subscribers {
		targets = append(targets, c)
	}
	h.mu.RUnlock()

	h.published.Add(1)
	h.publishedBytes.Add(int64(len(payload)))

	for _, c := range targets {
		select {
		case <-c.done:
			continue
		case c.send <- payload:
		default:
			h.slowConsumers.Add(1)
			h.logger.Warn(
				"relay_slow_consumer",
				"connection_id", c.connectionID,
				"subject_hash", c.subjectHash,
				"topic", topic,
				"queue_depth", len(c.send),
				"queue_capacity", cap(c.send),
			)
			h.removeClient(c)
			if c.onSlow != nil {
				c.onSlow()
			}
		}
	}

	batchID, sequence, frames := relayMessageTelemetry(message)
	publishElapsed := time.Since(started)
	publishSampled := sequence == 1 || (sequence > 0 && sequence%relayPublishSampleEvery == 0)
	if len(targets) > 0 && (publishSampled || publishElapsed >= relaySlowPublishThreshold) {
		h.logger.Info(
			"relay_publish",
			"batch_id", batchID,
			"topic", topic,
			"sequence", sequence,
			"frames", frames,
			"subscribers", len(targets),
			"payload_bytes", len(payload),
			"publish_ms", float64(publishElapsed.Microseconds())/1000,
			"slow_publish", publishElapsed >= relaySlowPublishThreshold,
		)
	}
}

func relayMessageTelemetry(message any) (string, int64, int) {
	switch value := message.(type) {
	case MarketMessage:
		return value.BatchID, value.Sequence, len(value.Frames)
	case *MarketMessage:
		if value != nil {
			return value.BatchID, value.Sequence, len(value.Frames)
		}
	case OrderbookMessage:
		return value.BatchID, value.Sequence, len(value.Frames)
	case *OrderbookMessage:
		if value != nil {
			return value.BatchID, value.Sequence, len(value.Frames)
		}
	}
	return "", 0, 0
}

func (h *Hub) Stats() HubStats {
	h.mu.RLock()
	defer h.mu.RUnlock()
	stats := HubStats{
		Clients:        len(h.clients),
		SlowConsumers:  h.slowConsumers.Load(),
		Published:      h.published.Load(),
		PublishedBytes: h.publishedBytes.Load(),
	}
	for topic := range h.topics {
		if topic == "market" {
			stats.MarketTopics++
		} else if strings.HasPrefix(topic, "orderbook:") {
			stats.OrderbookTopics++
		}
	}
	return stats
}

func (h *Hub) validTopicLocked(topic string) bool {
	if topic == "market" {
		return true
	}
	if !strings.HasPrefix(topic, "orderbook:") {
		return false
	}
	_, ok := h.universe[strings.TrimPrefix(topic, "orderbook:")]
	return ok
}

func normalizeTopic(topic string) string {
	topic = strings.TrimSpace(topic)
	if topic == "market" {
		return topic
	}
	if strings.HasPrefix(strings.ToLower(topic), "orderbook:") {
		symbol := strings.ToUpper(strings.TrimSpace(topic[len("orderbook:"):]))
		if symbol != "" {
			return "orderbook:" + symbol
		}
	}
	return ""
}
