package relay

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const (
	maxClientCommandBytes = 64 * 1024
	writeTimeout          = 5 * time.Second
)

type ServerConfig struct {
	ListenAddr     string
	SigningSecret  string
	AllowedOrigins []string
	AuthTimeout    time.Duration
	PingInterval   time.Duration
}

type Server struct {
	cfg      ServerConfig
	hub      *Hub
	logger   *slog.Logger
	origins  map[string]struct{}
	upgrader websocket.Upgrader
}

func NewServer(cfg ServerConfig, hub *Hub, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	if cfg.AuthTimeout <= 0 {
		cfg.AuthTimeout = 5 * time.Second
	}
	if cfg.PingInterval <= 0 {
		cfg.PingInterval = 15 * time.Second
	}
	origins := make(map[string]struct{}, len(cfg.AllowedOrigins))
	for _, origin := range cfg.AllowedOrigins {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			origins[origin] = struct{}{}
		}
	}
	s := &Server{cfg: cfg, hub: hub, logger: logger, origins: origins}
	s.upgrader = websocket.Upgrader{
		HandshakeTimeout: cfg.AuthTimeout,
		CheckOrigin: func(r *http.Request) bool {
			_, ok := s.origins[strings.TrimSpace(r.Header.Get("Origin"))]
			return ok
		},
	}
	return s
}

func (s *Server) Run(ctx context.Context) error {
	if strings.TrimSpace(s.cfg.ListenAddr) == "" || strings.TrimSpace(s.cfg.SigningSecret) == "" || len(s.origins) == 0 {
		return errors.New("relay server configuration invalid")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	httpServer := &http.Server{Addr: s.cfg.ListenAddr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	listener, err := net.Listen("tcp", s.cfg.ListenAddr)
	if err != nil {
		return err
	}
	errCh := make(chan error, 1)
	go func() { errCh <- httpServer.Serve(listener) }()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
		err := <-errCh
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	connectionID := newConnectionID()
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	remoteIPHash := hashIdentifier(s.cfg.SigningSecret, clientAddress(r))

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Warn(
			"relay_handshake_failed",
			"connection_id", connectionID,
			"origin", origin,
			"remote_ip_hash", remoteIPHash,
			"reason", "upgrade_rejected",
		)
		return
	}
	conn.SetReadLimit(maxClientCommandBytes)
	_ = conn.SetReadDeadline(time.Now().Add(s.cfg.AuthTimeout))

	var first clientMessage
	if err := conn.ReadJSON(&first); err != nil || first.Type != "auth" || strings.TrimSpace(first.Token) == "" {
		s.logger.Warn(
			"relay_auth_failed",
			"connection_id", connectionID,
			"origin", origin,
			"remote_ip_hash", remoteIPHash,
			"reason", "authentication_required",
		)
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "authentication required"), time.Now().Add(writeTimeout))
		_ = conn.Close()
		return
	}

	claims, err := VerifyToken(first.Token, s.cfg.SigningSecret, time.Now())
	if err != nil {
		s.logger.Warn(
			"relay_auth_failed",
			"connection_id", connectionID,
			"origin", origin,
			"remote_ip_hash", remoteIPHash,
			"reason", "token_invalid",
		)
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "authentication failed"), time.Now().Add(writeTimeout))
		_ = conn.Close()
		return
	}

	subjectHash := hashIdentifier(s.cfg.SigningSecret, claims.Subject)
	client := s.hub.newClient(connectionID, subjectHash, func() { _ = conn.Close() })
	s.hub.addClient(client)
	connectedAt := time.Now()
	disconnectCode := websocket.CloseNormalClosure
	disconnectReason := "client_closed"
	s.logger.Info(
		"relay_client_connected",
		"connection_id", connectionID,
		"subject_hash", subjectHash,
		"origin", origin,
		"remote_ip_hash", remoteIPHash,
	)
	defer func() {
		s.hub.removeClient(client)
		s.logger.Info(
			"relay_client_disconnected",
			"connection_id", connectionID,
			"subject_hash", subjectHash,
			"close_code", disconnectCode,
			"reason", disconnectReason,
			"lifetime_ms", time.Since(connectedAt).Milliseconds(),
		)
	}()

	readTimeout := 2 * s.cfg.PingInterval
	_ = conn.SetReadDeadline(time.Now().Add(readTimeout))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(readTimeout)) })
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		s.writeLoop(conn, client)
	}()

	if !enqueueJSON(client, readyMessage{Type: "ready", Protocol: ProtocolVersion, Epoch: s.hub.Epoch(), ServerTime: time.Now().UTC().Format(time.RFC3339Nano)}) {
		disconnectReason = "ready_queue_closed"
		return
	}

	for {
		var message clientMessage
		if err := conn.ReadJSON(&message); err != nil {
			disconnectReason = "read_closed"
			var closeErr *websocket.CloseError
			if errors.As(err, &closeErr) {
				disconnectCode = closeErr.Code
				disconnectReason = "websocket_close"
			}
			break
		}
		switch message.Type {
		case "subscribe":
			topics, err := s.hub.Subscribe(client, message.Topics)
			if err != nil {
				s.logger.Warn(
					"relay_subscription_rejected",
					"connection_id", connectionID,
					"subject_hash", subjectHash,
					"action", "subscribe",
					"reason", "invalid_topic_or_limit",
				)
				if !enqueueJSON(client, errorMessage{Type: "error", Code: "INVALID_TOPIC", Message: "Subscription rejected."}) {
					disconnectReason = "response_queue_closed"
					return
				}
				continue
			}
			s.logger.Info(
				"relay_subscription_changed",
				"connection_id", connectionID,
				"subject_hash", subjectHash,
				"action", "subscribe",
				"topics", topics,
			)
			if !enqueueJSON(client, subscribedMessage{Type: "subscribed", Topics: topics}) {
				disconnectReason = "response_queue_closed"
				return
			}
		case "unsubscribe":
			topics := s.hub.Unsubscribe(client, message.Topics)
			s.logger.Info(
				"relay_subscription_changed",
				"connection_id", connectionID,
				"subject_hash", subjectHash,
				"action", "unsubscribe",
				"topics", topics,
			)
			if !enqueueJSON(client, subscribedMessage{Type: "unsubscribed", Topics: topics}) {
				disconnectReason = "response_queue_closed"
				return
			}
		default:
			if !enqueueJSON(client, errorMessage{Type: "error", Code: "INVALID_MESSAGE", Message: "Message rejected."}) {
				disconnectReason = "response_queue_closed"
				return
			}
		}
	}
	client.stop()
	_ = conn.Close()
	<-writerDone
}

func (s *Server) writeLoop(conn *websocket.Conn, client *client) {
	ping := time.NewTicker(s.cfg.PingInterval)
	defer ping.Stop()
	for {
		select {
		case <-client.done:
			return
		case payload := <-client.send:
			_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				s.logger.Warn("relay_write_failed", "connection_id", client.connectionID, "subject_hash", client.subjectHash, "kind", "message")
				client.stop()
				return
			}
		case <-ping.C:
			if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeTimeout)); err != nil {
				s.logger.Warn("relay_write_failed", "connection_id", client.connectionID, "subject_hash", client.subjectHash, "kind", "ping")
				client.stop()
				return
			}
		}
	}
}

func enqueueJSON(client *client, message any) bool {
	payload, err := json.Marshal(message)
	if err != nil {
		return false
	}
	select {
	case <-client.done:
		return false
	case client.send <- payload:
		return true
	default:
		client.stop()
		return false
	}
}

func newConnectionID() string {
	var value [12]byte
	if _, err := rand.Read(value[:]); err == nil {
		return hex.EncodeToString(value[:])
	}
	return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
}

func hashIdentifier(secret, value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))[:16]
}

func clientAddress(r *http.Request) string {
	if value := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); value != "" {
		return value
	}
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
		if first, _, ok := strings.Cut(forwarded, ","); ok {
			return strings.TrimSpace(first)
		}
		return forwarded
	}
	if host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr)); err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}
