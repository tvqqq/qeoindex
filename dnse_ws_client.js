import crypto from 'node:crypto';

/**
 * DNSE WebSocket Client Expert Implementation
 * Connects to DNSE OpenAPI WebSocket endpoint, performs HMAC SHA256 authentication,
 * maintains PING/PONG keepalive, handles automatic reconnection, and subscribes to real-time feeds.
 */

const CONFIG = {
  apiKey: process.env.DNSE_API_KEY || '',
  apiSecret: process.env.DNSE_API_SECRET || '',
  wsUrl: process.env.DNSE_WS_URL || 'wss://ws-openapi.dnse.com.vn/v1/stream?encoding=json',
  pingIntervalMs: 25000,
  reconnectBaseDelayMs: 1000,
  maxReconnectDelayMs: 60000,
};

const CONTROL_ACTIONS = new Set([
  'welcome',
  'auth_success',
  'subscribed',
  'unsubscribed',
  'ping',
  'pong',
  'connection_expired',
  'error',
]);

export class DNSEWebSocketClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || CONFIG.apiKey;
    this.apiSecret = options.apiSecret || CONFIG.apiSecret;
    this.wsUrl = options.wsUrl || CONFIG.wsUrl;
    
    this.ws = null;
    this.pingTimer = null;
    this.reconnectAttempts = 0;
    this.isClosedManually = false;

    this.subscriptions = options.subscriptions || [
      {
        name: 'tick.G1.json',
        symbols: ['ACB', 'FPT', 'HPG', 'VHM', 'VIC', 'TCB', 'SSI', 'MSN', 'VNM', 'STB']
      },
      { name: 'market_index.VNINDEX.json' },
      { name: 'market_index.VN30.json' },
      { name: 'order.STOCK.json' },
      { name: 'position.STOCK.json' }
    ];

    this.onMarketData = options.onMarketData || this.defaultOnMarketData;
    this.onOrderData = options.onOrderData || this.defaultOnOrderData;
    this.onPositionData = options.onPositionData || this.defaultOnPositionData;
  }

  generateAuthPayload() {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = (Date.now() * 1000).toString();
    const rawMessage = `${this.apiKey}:${timestamp}:${nonce}`;
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(rawMessage)
      .digest('hex');

    return {
      action: 'auth',
      api_key: this.apiKey,
      signature: signature,
      timestamp: timestamp,
      nonce: nonce,
    };
  }

  connect() {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('DNSE_API_KEY and DNSE_API_SECRET must be configured in the server environment.');
    }
    this.isClosedManually = false;
    console.log(`[DNSE WS] Connecting to ${this.wsUrl}...`);
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      console.log('[DNSE WS] Connection established. Waiting for welcome message...');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (err) {
        console.error('[DNSE WS] Error parsing message JSON:', err.message, event.data);
      }
    };

    this.ws.onerror = (error) => {
      console.error('[DNSE WS] WebSocket Error:', error);
    };

    this.ws.onclose = (event) => {
      console.log(`[DNSE WS] Connection closed (code: ${event.code}, reason: "${event.reason || 'N/A'}")`);
      this.stopPingTimer();

      if (!this.isClosedManually) {
        this.scheduleReconnect();
      }
    };
  }

  handleMessage(data) {
    const action = data.action;

    // Check if it's a known control message
    if (action && CONTROL_ACTIONS.has(action)) {
      switch (action) {
        case 'welcome':
          console.log(`[DNSE WS] Received welcome (session: ${data.session_id}). Sending auth...`);
          this.send(this.generateAuthPayload());
          break;

        case 'auth_success':
          console.log('[DNSE WS] ✅ Authentication SUCCESS! Subscribing to channels...');
          this.subscribeChannels();
          this.startPingTimer();
          break;

        case 'subscribed':
          console.log(`[DNSE WS] Subscribed channel active: ${data.channel}`);
          break;

        case 'unsubscribed':
          console.log(`[DNSE WS] Unsubscribed channel: ${data.channel}`);
          break;

        case 'ping':
          // Echo server timestamp for RTT latency measurement
          this.send({ action: 'pong', timestamp: data.timestamp });
          break;

        case 'pong':
          // Response to client-initiated ping
          break;

        case 'connection_expired':
          console.warn('[DNSE WS] Server notification: 8-hour connection limit reached. Preparing to reconnect...');
          break;

        case 'error':
          console.error(`[DNSE WS] Server Error [${data.code}]: ${data.message}`);
          break;
      }
      return;
    }

    // Data Message Handling (discriminated by "T" field or channel format)
    const msgType = data.T;
    if (msgType === 't') {
      // Tick data
      this.onMarketData('TICK', data);
    } else if (msgType === 'mi') {
      // Market Index data
      this.onMarketData('INDEX', data);
    } else if (data.orderStatus || data.marketType && data.symbol) {
      // Realtime Order Event
      this.onOrderData(data);
    } else if (data.status && data.openQuantity !== undefined) {
      // Realtime Position Event
      this.onPositionData(data);
    } else {
      // Other data feed
      this.onMarketData('OTHER', data);
    }
  }

  subscribeChannels() {
    if (!this.subscriptions || this.subscriptions.length === 0) return;
    this.send({
      action: 'subscribe',
      channels: this.subscriptions,
    });
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      console.warn('[DNSE WS] Cannot send message, socket not OPEN.');
    }
  }

  startPingTimer() {
    this.stopPingTimer();
    this.pingTimer = setInterval(() => {
      this.send({ action: 'ping', timestamp: Date.now() });
    }, CONFIG.pingIntervalMs);
  }

  stopPingTimer() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  scheduleReconnect() {
    this.reconnectAttempts += 1;
    const delay = Math.min(
      CONFIG.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      CONFIG.maxReconnectDelayMs
    );
    console.log(`[DNSE WS] Reconnecting in ${delay}ms (Attempt #${this.reconnectAttempts})...`);
    setTimeout(() => {
      if (!this.isClosedManually) {
        this.connect();
      }
    }, delay);
  }

  close() {
    this.isClosedManually = true;
    this.stopPingTimer();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }
  }

  defaultOnMarketData(type, data) {
    if (type === 'TICK') {
      const price = (data.matchPrice || 0).toFixed(2);
      const qtty = (data.matchQtty || 0).toLocaleString();
      const totalVol = (data.totalVolumeTraded || 0).toLocaleString();
      console.log(`📈 [TICK] ${data.symbol.padEnd(6)} | Match Price: ${price} | Vol: ${qtty.padStart(6)} | Total Vol: ${totalVol}`);
    } else if (type === 'INDEX') {
      const name = (data.indexName || 'INDEX').padEnd(8);
      const val = (data.valueIndexes || 0).toFixed(2);
      const change = (data.changedValue > 0 ? '+' : '') + (data.changedValue || 0).toFixed(2);
      const ratio = (data.changedRatio > 0 ? '+' : '') + (data.changedRatio || 0).toFixed(2) + '%';
      console.log(`📊 [INDEX] ${name} | Value: ${val} | Change: ${change} (${ratio})`);
    } else {
      console.log(`🔔 [DATA]`, data);
    }
  }

  defaultOnOrderData(data) {
    console.log(`📋 [ORDER EVENT] ID: ${data.id} | Symbol: ${data.symbol} | Side: ${data.side} | Status: ${data.orderStatus} | Price: ${data.price} | Fills: ${data.fillQuantity}/${data.quantity}`);
  }

  defaultOnPositionData(data) {
    console.log(`💼 [POSITION EVENT] ID: ${data.id} | Symbol: ${data.symbol} | Side: ${data.side} | Open Qtty: ${data.openQuantity} | Cost: ${data.costPrice} | Market: ${data.marketPrice}`);
  }
}

// If run directly via node
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('dnse_ws_client.js')) {
  console.log('--- STARTING DNSE REALTIME WEBSOCKET DEMO ---');
  const client = new DNSEWebSocketClient();
  client.connect();

  process.on('SIGINT', () => {
    console.log('\nGracefully shutting down...');
    client.close();
    process.exit(0);
  });
}
