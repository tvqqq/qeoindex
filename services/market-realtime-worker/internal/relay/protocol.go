package relay

import "time"

const ProtocolVersion = 1

type clientMessage struct {
	Type   string   `json:"type"`
	Token  string   `json:"token,omitempty"`
	Topics []string `json:"topics,omitempty"`
}

type readyMessage struct {
	Type       string `json:"type"`
	Protocol   int    `json:"protocol"`
	Epoch      string `json:"epoch"`
	ServerTime string `json:"serverTime"`
}

type subscribedMessage struct {
	Type   string   `json:"type"`
	Topics []string `json:"topics"`
}

type errorMessage struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type MarketMessage struct {
	Type        string           `json:"type"`
	Epoch       string           `json:"epoch"`
	Sequence    int64            `json:"sequence"`
	PublishedAt string           `json:"publishedAt"`
	Frames      []map[string]any `json:"frames"`
}

type OrderbookMessage struct {
	Type          string           `json:"type"`
	Symbol        string           `json:"symbol"`
	Epoch         string           `json:"epoch"`
	Sequence      int64            `json:"sequence"`
	PublishedAt   string           `json:"publishedAt"`
	ContinuityGap bool             `json:"continuityGap"`
	Frames        []map[string]any `json:"frames"`
}

func NewMarketMessage(epoch string, sequence int64, frames []map[string]any) MarketMessage {
	return MarketMessage{Type: "market", Epoch: epoch, Sequence: sequence, PublishedAt: time.Now().UTC().Format(time.RFC3339Nano), Frames: frames}
}

func NewOrderbookMessage(epoch, symbol string, sequence int64, continuityGap bool, frames []map[string]any) OrderbookMessage {
	return OrderbookMessage{Type: "orderbook", Symbol: symbol, Epoch: epoch, Sequence: sequence, PublishedAt: time.Now().UTC().Format(time.RFC3339Nano), ContinuityGap: continuityGap, Frames: frames}
}
