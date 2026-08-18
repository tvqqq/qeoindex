-- Enable Realtime publication for stock_orderbook_snapshots table
ALTER TABLE public.stock_orderbook_snapshots REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'stock_orderbook_snapshots'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_orderbook_snapshots;
  END IF;
END $$;
