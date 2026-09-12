package dnseauth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"time"
)

type Auth struct{ apiKey, apiSecret string }
type Payload struct {
	Action    string `json:"action"`
	APIKey    string `json:"api_key"`
	Signature string `json:"signature"`
	Timestamp int64  `json:"timestamp"`
	Nonce     string `json:"nonce"`
}

func New(apiKey, apiSecret string) Auth { return Auth{apiKey: apiKey, apiSecret: apiSecret} }
func (a Auth) Payload(now time.Time) (Payload, error) {
	var raw [2]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return Payload{}, err
	}
	return a.PayloadWithSuffix(now, int64(binary.BigEndian.Uint16(raw[:])%1000)), nil
}
func (a Auth) PayloadWithSuffix(now time.Time, suffix int64) Payload {
	timestamp := now.Unix()
	nonce := fmt.Sprintf("%d", now.UnixMilli()*1000+(suffix%1000+1000)%1000)
	message := fmt.Sprintf("%s:%d:%s", a.apiKey, timestamp, nonce)
	mac := hmac.New(sha256.New, []byte(a.apiSecret))
	_, _ = mac.Write([]byte(message))
	return Payload{Action: "auth", APIKey: a.apiKey, Signature: hex.EncodeToString(mac.Sum(nil)), Timestamp: timestamp, Nonce: nonce}
}
