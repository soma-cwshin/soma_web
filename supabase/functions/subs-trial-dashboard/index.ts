import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-maps-insights-key',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const secret = Deno.env.get('MAPS_INSIGHTS_SECRET');
  if (!secret) {
    return json({ error: 'MAPS_INSIGHTS_SECRET not configured' }, 503);
  }
  if (req.headers.get('x-maps-insights-key') !== secret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get('since');
  const since = sinceParam ? sinceParam : '2026-08-10T00:00:00+09:00';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data, error } = await supabase.rpc('subs_trial_dashboard', {
    p_since: since,
  });

  if (error) {
    return json({ error: 'dashboard_failed', message: error.message }, 500);
  }

  return json(data ?? { ok: false, error: 'empty' });
});
