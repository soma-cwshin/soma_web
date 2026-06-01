-- soma-maps Supabase SQL Editor에서 1회 실행
ALTER TABLE public.maps_sales_sync
  ADD COLUMN IF NOT EXISTS hours_cache jsonb NOT NULL DEFAULT '{}'::jsonb;
