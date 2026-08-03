import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.44.4';

// 일반 청구 링크 조회 (결제 페이지 /pay/invoice 진입 시 호출).
// get-payment-link 의 청구서 버전. 구독 관련 필드는 일절 반환하지 않는다.
// verify_jwt = false 로 배포할 것 (비로그인 결제 페이지에서 호출).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function jsonResp(d: unknown, s: number) {
  return new Response(JSON.stringify(d), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    status: s,
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = body?.token;
    if (!token || typeof token !== 'string') return jsonResp({ valid: false, reason: 'invalid_token' }, 400);

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: inv } = await sb.from('invoice_links')
      .select('id, user_id, order_name, amount, status, expires_at')
      .eq('token', token).maybeSingle();

    if (!inv) return jsonResp({ valid: false, reason: 'not_found' }, 404);
    if (inv.status === 'paid') return jsonResp({ valid: false, reason: 'already_paid' }, 200);
    if (inv.status === 'cancelled') return jsonResp({ valid: false, reason: 'cancelled' }, 200);
    if (new Date(inv.expires_at).getTime() < Date.now()) return jsonResp({ valid: false, reason: 'expired' }, 200);

    let memberName: string | null = null;
    try {
      const { data: u } = await sb.from('users').select('name').eq('id', inv.user_id).maybeSingle();
      memberName = (u as { name?: string } | null)?.name ?? null;
    } catch (_e) { /* ignore */ }

    return jsonResp({
      valid: true,
      order_name: inv.order_name,
      amount: inv.amount,
      member_name: memberName,
      user_id: inv.user_id,
    }, 200);
  } catch (e) {
    return jsonResp({ valid: false, reason: 'error', detail: String(e) }, 500);
  }
});
