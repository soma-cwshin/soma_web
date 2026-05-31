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
  const name = url.searchParams.get('name')?.trim();
  if (!name) {
    return json({ error: 'name required' }, 400);
  }
  const address = url.searchParams.get('address')?.trim() || '';
  const phone = url.searchParams.get('phone')?.trim() || '';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: matches, error: matchErr } = await supabase.rpc('maps_center_match', {
    p_name: name,
    p_address: address,
    p_phone: phone,
  });
  if (matchErr) {
    return json({ error: 'match_failed', message: matchErr.message }, 500);
  }

  const match = matches?.[0];
  if (!match) {
    return json({
      ok: true,
      registered: false,
      match: null,
      bookingActivity: null,
      plans: null,
    });
  }

  const { data: insights, error: insightsErr } = await supabase.rpc('maps_center_insights_by_id', {
    p_center_id: match.center_id,
  });
  if (insightsErr) {
    return json({ error: 'insights_failed', message: insightsErr.message }, 500);
  }

  return json({
    ok: true,
    registered: true,
    match: {
      centerId: match.center_id,
      name: match.center_name,
      address: match.center_address,
      contactNumber: match.contact_number,
      isRegistered: match.is_registered,
      registeredAt: match.registered_at,
      matchScore: match.match_score,
    },
    bookingActivity: insights.bookingActivity,
    plans: {
      staff: insights.staffPlans,
      memberPasses: insights.memberPasses,
      people: insights.people,
    },
  });
});
