import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.44.4';

// 일반 청구(수납 전용) 결제 검증 EF.
//
// verify-payment-link 와의 결정적 차이:
//   - subscriptions 를 절대 읽지도 쓰지도 않는다. (구독 생성/연장 없음)
//   - 기존 활성 구독 / IAP 구독이 있어도 아무 영향이 없다.
//   - 어떤 경우에도 PortOne 자동 취소(환불)를 호출하지 않는다.
//     (받아야 할 돈이므로 이상 상황은 환불 대신 관리자 알림으로 처리)
//
// 하는 일: PortOne 결제 실검증(상태·금액·결제자) → invoice_links 를 paid 로 마킹 → 관리자 푸시.
// verify_jwt = false 로 배포할 것.

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

const createAdmin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

function shortenUserId(userId: string): string {
  const hex = userId.replace(/-/g, '');
  return hex.length >= 20 ? hex.slice(0, 20) : hex;
}

async function fetchPortonePayment(paymentId: string): Promise<any> {
  const secret = Deno.env.get('PORTONE_V2_API_SECRET');
  if (!secret) throw new Error('PORTONE_V2_API_SECRET not configured');
  const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
    headers: { 'Authorization': `PortOne ${secret}` },
  });
  const b = await res.json();
  if (!res.ok) throw new Error(`PortOne GET /payments ${res.status}: ${JSON.stringify(b)}`);
  return b;
}

// ── 관리자 FCM 푸시 (verify-payment-link 와 동일 방식) ──
function b64url(input: string) { return btoa(input).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
async function importPrivateKey(pem: string) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\n/g, '\n').replace(/\r/g, '').trim();
  const binary = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey('pkcs8', binary, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
async function adminAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const key = await importPrivateKey(privateKey);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(String.fromCharCode(...new Uint8Array(sig)))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`oauth ${res.status}`);
  return (await res.json()).access_token;
}
async function pushAdmins(sb: any, title: string, bodyText: string, data: Record<string, string>): Promise<void> {
  try {
    const { data: toks } = await sb.from('admin_push_tokens').select('token');
    const tokens = (toks ?? []).map((t: any) => t.token).filter((t: unknown) => typeof t === 'string' && (t as string).length > 0);
    const projectId = Deno.env.get('GCP_PROJECT_ID');
    const clientEmail = Deno.env.get('GOOGLE_CLIENT_EMAIL');
    const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY');
    if (!tokens.length || !projectId || !clientEmail || !privateKey) return;
    const accessToken = await adminAccessToken(clientEmail, privateKey);
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
    await Promise.allSettled(tokens.map((token: string) => fetch(fcmUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token, notification: { title, body: bodyText }, data,
          android: { priority: 'HIGH', notification: { sound: 'default' } },
          apns: {
            headers: { 'apns-push-type': 'alert', 'apns-priority': '10' },
            payload: { aps: { alert: { title, body: bodyText }, sound: 'default', badge: 1 } },
          },
        },
      }),
    })));
  } catch (e) { console.error('[verify-invoice-payment] pushAdmins error:', String(e)); }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { token, paymentId } = body;
    if (!token || typeof token !== 'string') return jsonResp({ success: false, error: 'invalid_token' }, 400);
    if (!paymentId || typeof paymentId !== 'string') return jsonResp({ success: false, error: 'invalid_payment_id' }, 400);

    const sb = createAdmin();

    const { data: inv } = await sb.from('invoice_links')
      .select('id, user_id, order_name, amount, status, expires_at')
      .eq('token', token).maybeSingle();
    if (!inv) return jsonResp({ success: false, error: 'link_not_found' }, 404);
    if (inv.status === 'paid') return jsonResp({ success: true, message: 'already_paid', idempotent: true }, 200);
    if (inv.status === 'cancelled') return jsonResp({ success: false, error: 'link_cancelled' }, 400);
    if (new Date(inv.expires_at).getTime() < Date.now()) return jsonResp({ success: false, error: 'link_expired' }, 400);

    const userId = inv.user_id as string;

    // 동일 결제건 재검증(리다이렉트 중복 복귀 등) → 멱등 처리
    const { data: dupe } = await sb.from('invoice_links').select('id')
      .eq('portone_payment_id', paymentId).maybeSingle();
    if (dupe) return jsonResp({ success: true, message: 'already_paid', idempotent: true }, 200);

    const payment = await fetchPortonePayment(paymentId);
    if (payment.status !== 'PAID') {
      const code = (payment.status === 'CANCELLED' || payment.status === 'FAILED') ? 'payment_not_paid' : 'payment_pending';
      return jsonResp({ success: false, error: code, status: payment.status }, 400);
    }

    if (payment.amount?.total !== inv.amount) {
      // 환불하지 않는다. 관리자가 직접 판단하도록 알림만.
      console.error(`[verify-invoice-payment] amount mismatch invoice=${inv.id} expected=${inv.amount} got=${payment.amount?.total}`);
      await pushAdmins(sb, '청구 금액 불일치 — 확인 필요',
        `${inv.order_name} · 청구 ${Number(inv.amount).toLocaleString('ko-KR')}원 / 결제 ${Number(payment.amount?.total ?? 0).toLocaleString('ko-KR')}원`,
        { type: 'invoice_amount_mismatch', user_id: userId, invoice_id: String(inv.id) });
      return jsonResp({ success: false, error: 'amount_mismatch', expected: inv.amount, got: payment.amount?.total }, 400);
    }

    let customData: any = null;
    try { customData = typeof payment.customData === 'string' ? JSON.parse(payment.customData) : payment.customData; } catch (_e) { customData = null; }
    if (customData?.userId !== userId && payment.customer?.id !== shortenUserId(userId)) {
      return jsonResp({ success: false, error: 'user_mismatch' }, 400);
    }

    const { error: updErr } = await sb.from('invoice_links').update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      portone_payment_id: paymentId,
    }).eq('id', inv.id).eq('status', 'pending');

    if (updErr) {
      // 결제는 이미 성사됐다. 환불하지 않고 관리자에게 수기 처리를 알린다.
      console.error(`[verify-invoice-payment] mark-paid failed invoice=${inv.id} payment=${paymentId}: ${updErr.message}`);
      await pushAdmins(sb, '수납 기록 실패 — 수기 확인 필요',
        `${inv.order_name} · 결제는 완료됨(${paymentId})`,
        { type: 'invoice_record_failed', user_id: userId, invoice_id: String(inv.id), payment_id: paymentId });
      return jsonResp({ success: false, error: 'record_failed', message: '결제는 완료됐으나 기록에 실패했습니다. 고객센터로 문의해주세요.' }, 500);
    }

    {
      const { data: prof } = await sb.from('users').select('name').eq('id', userId).maybeSingle();
      const who = (prof as { name?: string } | null)?.name ?? '고객';
      await pushAdmins(sb, '수납 완료',
        `${who} · ${inv.order_name} · ${Number(inv.amount).toLocaleString('ko-KR')}원`,
        { type: 'invoice_paid', user_id: userId, invoice_id: String(inv.id) });
    }

    console.log(`[verify-invoice-payment] paid invoice=${inv.id} user=${userId} amount=${inv.amount} payment=${paymentId}`);
    return jsonResp({ success: true, invoice_id: inv.id, amount: inv.amount }, 200);
  } catch (e) {
    console.error('[verify-invoice-payment] error:', String(e));
    return jsonResp({ success: false, error: 'internal_error', message: String(e) }, 500);
  }
});
