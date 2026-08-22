-- QeoIndex: Supabase OrderBook Snapshots Table
-- Used to cache and serve 100 universe stocks orderbook snapshots (1m intraday, trades, depth, foreign flow)

CREATE TABLE IF NOT EXISTS public.stock_orderbook_snapshots (
  symbol VARCHAR(10) PRIMARY KEY,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_price NUMERIC(10, 2),
  ceiling_price NUMERIC(10, 2),
  floor_price NUMERIC(10, 2),
  latest_price NUMERIC(10, 2),
  total_volume BIGINT DEFAULT 0,
  
  -- Intraday 1m candle bars: [{ time: number, open: number, close: number }]
  intraday_1m JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Matched trades sequence: [{ id: string, time: number, price: number, volume: number, side: string }]
  trades JSONB NOT NULL DEFAULT '[]'::jsonb,
  trades_truncated BOOLEAN DEFAULT FALSE,
  
  -- Top orderbook depth
  latest_quote JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Foreign investor flow: { totalBuyVolume, totalSellVolume, totalBuyValue, totalSellValue, foreignNetValue }
  foreign_flow JSONB DEFAULT '{}'::jsonb,
  
  -- Put-through block deals
  put_through JSONB DEFAULT '[]'::jsonb,
  
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for lightning fast lookups
CREATE INDEX IF NOT EXISTS idx_stock_orderbook_symbol_date ON public.stock_orderbook_snapshots (symbol, session_date);
CREATE INDEX IF NOT EXISTS idx_stock_orderbook_updated ON public.stock_orderbook_snapshots (updated_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.stock_orderbook_snapshots ENABLE ROW LEVEL SECURITY;

-- Allow public read access to orderbook snapshots
DROP POLICY IF EXISTS "Allow public read access to orderbook snapshots" ON public.stock_orderbook_snapshots;
CREATE POLICY "Allow public read access to orderbook snapshots"
  ON public.stock_orderbook_snapshots
  FOR SELECT
  USING (true);

-- Allow service role full access for background worker ingestion
DROP POLICY IF EXISTS "Allow service role full access to orderbook snapshots" ON public.stock_orderbook_snapshots;
CREATE POLICY "Allow service role full access to orderbook snapshots"
  ON public.stock_orderbook_snapshots
  FOR ALL
  USING (auth.role() = 'service_role');
