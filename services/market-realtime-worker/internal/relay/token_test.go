package relay

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

func signTestToken(t *testing.T, claims Claims, secret string) string {
	t.Helper()
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	part := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(part))
	return part + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func TestVerifyTokenAcceptsCompatibleClaims(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	claims := Claims{Version: 1, Subject: "user-1", Audience: TokenAudience, IssuedAt: now.Unix(), ExpiresAt: now.Add(60 * time.Second).Unix()}
	token := signTestToken(t, claims, "secret")
	got, err := VerifyToken(token, "secret", now.Add(time.Second))
	if err != nil {
		t.Fatalf("VerifyToken() error = %v", err)
	}
	if got.Subject != claims.Subject || got.Audience != TokenAudience {
		t.Fatalf("unexpected claims: %#v", got)
	}
}

func TestVerifyTokenRejectsInvalidTokens(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	base := Claims{Version: 1, Subject: "user-1", Audience: TokenAudience, IssuedAt: now.Unix(), ExpiresAt: now.Add(60 * time.Second).Unix()}
	tests := []struct {
		name   string
		claims Claims
		secret string
		verify string
		at     time.Time
	}{
		{name: "bad signature", claims: base, secret: "secret", verify: "other", at: now},
		{name: "wrong audience", claims: Claims{Version: 1, Subject: "user-1", Audience: "other", IssuedAt: base.IssuedAt, ExpiresAt: base.ExpiresAt}, secret: "secret", verify: "secret", at: now},
		{name: "wrong version", claims: Claims{Version: 2, Subject: "user-1", Audience: TokenAudience, IssuedAt: base.IssuedAt, ExpiresAt: base.ExpiresAt}, secret: "secret", verify: "secret", at: now},
		{name: "too long", claims: Claims{Version: 1, Subject: "user-1", Audience: TokenAudience, IssuedAt: base.IssuedAt, ExpiresAt: now.Add(61 * time.Second).Unix()}, secret: "secret", verify: "secret", at: now},
		{name: "expired", claims: base, secret: "secret", verify: "secret", at: now.Add(61 * time.Second)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := VerifyToken(signTestToken(t, tt.claims, tt.secret), tt.verify, tt.at); err == nil {
				t.Fatal("expected verification error")
			}
		})
	}
}

func TestVerifyTokenRejectsMalformedInput(t *testing.T) {
	for _, token := range []string{"", "abc", "abc.def.ghi", "%%%.%%%"} {
		if _, err := VerifyToken(token, "secret", time.Now()); err == nil {
			t.Fatalf("expected malformed token %q to fail", token)
		}
	}
}
