package dnseauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"testing"
	"time"
)

func TestPayloadMatchesQEO175HMACContract(t *testing.T) {
	now := time.UnixMilli(1_700_000_000_123)
	auth := New("key", "secret")
	payload := auth.PayloadWithSuffix(now, 7)
	message := fmt.Sprintf("%s:%d:%s", "key", now.Unix(), payload.Nonce)
	mac := hmac.New(sha256.New, []byte("secret"))
	_, _ = mac.Write([]byte(message))
	want := hex.EncodeToString(mac.Sum(nil))
	if payload.Action != "auth" || payload.APIKey != "key" || payload.Signature != want {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}
