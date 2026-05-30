-- Run once in a NEW Supabase project (영업 지도 전용, 앱 DB와 분리)
-- Supabase Dashboard → SQL Editor → New query → 붙여넣기 → Run

CREATE TABLE IF NOT EXISTS public.maps_sales_sync (
  id text PRIMARY KEY DEFAULT 'default',
  visit_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  route_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  coord_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  geocode_skipped jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.maps_sales_sync ENABLE ROW LEVEL SECURITY;

INSERT INTO public.maps_sales_sync (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;
