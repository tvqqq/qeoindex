import asyncio
import hmac
import hashlib
import time
import json
import logging
import sys

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("DNSE_WS")

API_KEY = "eyJvcmciOiJkbnNlIiwiaWQiOiI2NzMzNWM2MzhhOTQ0MTVmYmU1M2UxY2RiYjg2Y2ZkYSIsImgiOiJtdXJtdXIxMjgifQ=="
API_SECRET = "jICOG0y4FIx20XhQ4O47g5OZY6sBRUxqcvNMgoNaKU9KspTk4Vrnei8-xn1AQ0CMzd-CZRkojjlNZGtsm20AjA"
URL = "wss://ws-openapi.dnse.com.vn/v1/stream?encoding=json"

CONTROL_ACTIONS = {
    "welcome",
    "auth_success",
    "subscribed",
    "unsubscribed",
    "ping",
    "pong",
    "connection_expired",
    "error",
}

def make_auth_message(api_key: str, api_secret: str) -> dict:
    """Generate DNSE HMAC-SHA256 Auth message signature"""
    timestamp = int(time.time())
    nonce = str(int(time.time() * 1_000_000))
    message = f"{api_key}:{timestamp}:{nonce}"
    signature = hmac.new(
        api_secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()

    return {
        "action": "auth",
        "api_key": api_key,
        "signature": signature,
        "timestamp": timestamp,
        "nonce": nonce,
    }

async def keep_alive(ws, interval=25):
    """Client side active keep-alive ping loop"""
    try:
        while True:
            await asyncio.sleep(interval)
            payload = {"action": "ping", "timestamp": int(time.time() * 1000)}
            await ws.send(json.dumps(payload))
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.warning(f"Keep-alive ping error: {e}")

async def run_dnse_client():
    import websockets

    backoff = 1
    subscriptions = [
        {
            "name": "tick.G1.json",
            "symbols": ["ACB", "FPT", "HPG", "VHM", "VIC", "TCB", "SSI", "MSN", "VNM", "STB"]
        },
        {"name": "market_index.VNINDEX.json"},
        {"name": "market_index.VN30.json"},
        {"name": "order.STOCK.json"},
        {"name": "position.STOCK.json"}
    ]

    while True:
        try:
            logger.info(f"Connecting to DNSE WebSocket: {URL}")
            async with websockets.connect(URL) as ws:
                backoff = 1  # Reset backoff on successful connection
                ping_task = asyncio.create_task(keep_alive(ws))

                # Step 1: Wait for Welcome message
                welcome_raw = await ws.recv()
                welcome = json.loads(welcome_raw)
                logger.info(f"Session initialized: {welcome.get('session_id')}")

                # Step 2: Send Auth
                auth_msg = make_auth_message(API_KEY, API_SECRET)
                await ws.send(json.dumps(auth_msg))

                # Step 3: Event Loop
                async for raw_msg in ws:
                    data = json.loads(raw_msg)
                    action = data.get("action")

                    if action in CONTROL_ACTIONS:
                        if action == "auth_success":
                            logger.info("✅ Auth Success! Subscribing to channels...")
                            await ws.send(json.dumps({
                                "action": "subscribe",
                                "channels": subscriptions
                            }))
                        elif action == "subscribed":
                            logger.info(f"Subscribed OK: {data.get('channel')}")
                        elif action == "ping":
                            # Echo timestamp for latency check
                            await ws.send(json.dumps({
                                "action": "pong",
                                "timestamp": data.get("timestamp")
                            }))
                        elif action == "connection_expired":
                            logger.warning("8-hour limit reached. Preparing auto reconnect...")
                            break
                        elif action == "error":
                            logger.error(f"Error [{data.get('code')}]: {data.get('message')}")
                    else:
                        # Process Real-time Data Feed
                        msg_type = data.get("T")
                        if msg_type == "t":
                            sym = data.get("symbol")
                            price = data.get("matchPrice")
                            qtty = data.get("matchQtty")
                            logger.info(f"📈 TICK | {sym:<6} | Match Price: {price} | Vol: {qtty}")
                        elif msg_type == "mi":
                            name = data.get("indexName")
                            val = data.get("valueIndexes")
                            change = data.get("changedValue")
                            ratio = data.get("changedRatio")
                            logger.info(f"📊 INDEX | {name:<8} | Value: {val} | Change: {change} ({ratio}%)")
                        elif "orderStatus" in data:
                            logger.info(f"📋 ORDER | {data.get('symbol')} | Side: {data.get('side')} | Status: {data.get('orderStatus')}")
                        elif "openQuantity" in data:
                            logger.info(f"💼 POSITION | {data.get('symbol')} | Side: {data.get('side')} | Open: {data.get('openQuantity')}")
                        else:
                            logger.info(f"🔔 DATA: {data}")

                ping_task.cancel()

        except Exception as e:
            logger.error(f"WebSocket connection error: {e}")

        logger.info(f"Reconnecting in {backoff} seconds...")
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)

if __name__ == "__main__":
    try:
        asyncio.run(run_dnse_client())
    except KeyboardInterrupt:
        logger.info("Stopped by user.")
