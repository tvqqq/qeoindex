package relay

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const (
	TokenAudience = "qeo-market-realtime"
	TokenVersion  = 1
	maxTokenTTL   = 60 * time.Second
)

type Claims struct {
	Version  int    `json:"v"`
	Subject  string `json:"sub"`
	Audience string `json:"aud"`
	IssuedAt int64  `json:"iat"`
	ExpiresAt int64 `json:"exp"`
}

func VerifyToken(token, secret string, now time.Time) (Claims, error) {
	var claims Claims
	parts := strings.Split(token, ".")
	if len(parts) != 2 || strings.TrimSpace(secret) == "" {
		return claims, errors.New("invalid relay token")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(parts[0]))
	expected := mac.Sum(nil)
	actual, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(actual, expected) {
		return claims, errors.New("invalid relay token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(payload, &claims) != nil {
		return Claims{}, errors.New("invalid relay token")
	}
	if claims.Version != TokenVersion || claims.Audience != TokenAudience || strings.TrimSpace(claims.Subject) == "" {
		return Claims{}, errors.New("invalid relay token")
	}
	if claims.IssuedAt <= 0 || claims.ExpiresAt <= claims.IssuedAt {
		return Claims{}, errors.New("invalid relay token")
	}
	if time.Duration(claims.ExpiresAt-claims.IssuedAt)*time.Second > maxTokenTTL {
		return Claims{}, errors.New("invalid relay token")
	}
	nowUnix := now.Unix()
	if nowUnix < claims.IssuedAt-5 || nowUnix >= claims.ExpiresAt {
		return Claims{}, errors.New("relay token expired or not active")
	}
	return claims, nil
}
