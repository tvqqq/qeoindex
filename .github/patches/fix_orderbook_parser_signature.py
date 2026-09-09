from pathlib import Path

path = Path("components/orderbook/live-orderbook-panel.tsx")
text = path.read_text()
old = 'const parseRawTrades = (rawTrades?: any[], source: TradeSource): StreamTrade[] => {'
new = 'const parseRawTrades = (rawTrades: any[] | undefined, source: TradeSource): StreamTrade[] => {'
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected one parseRawTrades signature, found {count}")
path.write_text(text.replace(old, new, 1))
