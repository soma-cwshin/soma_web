-- soma-maps 전용 Supabase (1회 실행)
CREATE TABLE IF NOT EXISTS public.maps_sales_sync (
  id text PRIMARY KEY DEFAULT 'default',
  visit_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  route_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  coord_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  geocode_skipped jsonb NOT NULL DEFAULT '[]'::jsonb,
  hours_cache jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.maps_sales_sync ENABLE ROW LEVEL SECURITY;
INSERT INTO public.maps_sales_sync (id) VALUES ('default') ON CONFLICT DO NOTHING;
