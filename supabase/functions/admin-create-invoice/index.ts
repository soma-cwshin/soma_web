import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.44.4';

// 관리자가 임의 금액을 청구하는 "일반 청구" 링크 생성 + 문자 발송 EF.
//
// 구독과 무관한 순수 수납용이다. 결제가 완료돼도 verify-invoice-payment 는
// subscriptions 를 생성/연장하지 않는다.
//
// preview_only=true  → 링크 확보 후 메시지 본문만 반환(미리보기·복사용). 문자 미발송.
// preview_only=false → 동일 링크로 실제 SMS(SENS LMS) 발송.
//
// 기존 admin-send-payment-link / create-payment-link / payment_links 는 건드리지 않는다.
// verify_jwt = true 로 배포할 것.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BASE_URL = 'https://soma.ai.kr/pay/invoice';
const CS_PHONE = '0502-1935-5034';
const EXPIRES_HOURS = 72; // 거래처 결제는 며칠 걸릴 수 있어 구독링크(24h)보다 길게

function jsonResp(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    status,
  });
}

const createAdminClient = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

/** 관리자 인증. service_role 키 직호출이면 통과, 아니면 app_admins 확인. */
async function resolveAdmin(req: Request): Promise<{ denied: Response } | { adminId: string | null }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '');
  if (bearer === (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '__none__')) return { adminId: null };

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return { denied: jsonResp({ success: false, error: 'auth_required' }, 401) };

  const guard = createAdminClient();
  const { data: adminRow } = await guard.from('app_admins').select('user_id').eq('user_id', u.user.id).maybeSingle();
  if (!adminRow) return { denied: jsonResp({ success: false, error: 'admin_only' }, 403) };
  return { adminId: u.user.id };
}

function genToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function normalizeLocalPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('82')) return '0' + d.slice(2);
  if (d.startsWith('0')) return d;
  return '0' + d;
}

async function makeSensSignature(secretKey: string, method: string, url: string, timestamp: string, accessKey: string) {
  const enc = new TextEncoder();
  const msg = `${method} ${url}\n${timestamp}\n${accessKey}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
}

async function sendSMS(phone: string, message: string) {
  const accessKey = Deno.env.get('NCP_ACCESS_KEY');
  const secretKey = Deno.env.get('NCP_SECRET_KEY');
  const serviceId = Deno.env.get('NCP_SERVICE_ID');
  const sender = Deno.env.get('NCP_SENS_SENDER');
  if (!accessKey || !secretKey || !serviceId || !sender) throw new Error('NCP SENS 환경변수 미설정');

  const urlPath = `/sms/v2/services/${serviceId}/messages`;
  const apiUrl = `https://sens.apigw.ntruss.com${urlPath}`;
  const timestamp = Date.now().toString();
  const signature = await makeSensSignature(secretKey, 'POST', urlPath, timestamp, accessKey);
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'x-ncp-apigw-timestamp': timestamp,
      'x-ncp-iam-access-key': accessKey,
      'x-ncp-apigw-signature-v2': signature,
    },
    body: JSON.stringify({
      type: 'LMS',
      contentType: 'COMM',
      countryCode: '82',
      from: sender,
      subject: '[SOMA] 결제 안내',
      content: message,
      messages: [{ to: phone }],
    }),
  });
  if (res.status !== 202) throw new Error(`SMS 전송 실패: ${await res.text()}`);
}

function buildMessage(name: string | null, orderName: string, amount: number, url: string): string {
  const who = name ?? '고객';
  return `[SOMA] ${who}님, ${orderName} 결제 안내입니다.\n`
    + `결제 금액: ${amount.toLocaleString('ko-KR')}원\n`
    + `아래 링크에서 결제를 완료해 주세요.\n${url}\n`
    + `링크는 ${EXPIRES_HOURS}시간 후 만료됩니다.\n`
    + `상담·문의 ${CS_PHONE}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = await resolveAdmin(req);
    if ('denied' in auth) return auth.denied;

    const body = await req.json().catch(() => ({}));
    const sb = createAdminClient();

    const previewOnly = body?.preview_only === true;
    const userId: string | null = body?.user_id ?? null;
    if (!userId) return jsonResp({ success: false, error: 'missing_user' }, 400);

    const rawAmount = Number(body?.amount);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return jsonResp({ success: false, error: 'invalid_amount', message: '청구 금액을 입력해 주세요.' }, 400);
    }
    const amount = Math.round(rawAmount);

    const orderName = typeof body?.order_name === 'string' ? body.order_name.trim() : '';
    if (!orderName) {
      return jsonResp({ success: false, error: 'invalid_order_name', message: '청구 항목명을 입력해 주세요.' }, 400);
    }
    const memo = (typeof body?.memo === 'string' && body.memo.trim().length > 0) ? body.memo.trim() : null;

    // 회원 이름·전화번호
    const { data: prof } = await sb.from('users').select('name, phone').eq('id', userId).maybeSingle();
    const name: string | null = (prof as { name?: string } | null)?.name ?? null;
    const phone: string | null = (prof as { phone?: string } | null)?.phone ?? null;

    // 미리보기 → 발송 흐름에서 링크가 중복 생성되지 않도록,
    // 동일 조건(회원·금액·항목명)의 진행중 링크가 있으면 재사용한다.
    let token: string | null = null;
    const { data: existing } = await sb.from('invoice_links')
      .select('id, token')
      .eq('user_id', userId).eq('amount', amount).eq('order_name', orderName).eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing) {
      token = (existing as { token: string }).token;
      // 미리보기 후 메모만 바뀐 경우 반영 (금액·항목명이 같으므로 링크는 그대로 재사용)
      await sb.from('invoice_links').update({ memo }).eq('id', (existing as { id: string }).id);
    }

    if (!token) {
      const newToken = genToken();
      const expiresAt = new Date(Date.now() + EXPIRES_HOURS * 3600 * 1000).toISOString();
      const { error: insErr } = await sb.from('invoice_links').insert({
        token: newToken,
        user_id: userId,
        order_name: orderName,
        amount,
        memo,
        status: 'pending',
        created_by: auth.adminId,
        expires_at: expiresAt,
      });
      if (insErr) return jsonResp({ success: false, error: 'insert_failed', detail: insErr.message }, 500);
      token = newToken;
    }

    const url = `${BASE_URL}?token=${token}`;
    const message = buildMessage(name, orderName, amount, url);

    if (previewOnly) {
      return jsonResp({
        success: true,
        data: { token, url, amount, message_preview: message, name, phone, has_phone: !!phone },
      }, 200);
    }

    if (!phone) {
      return jsonResp({ success: false, error: 'no_phone', message: '회원 전화번호가 없어 문자를 보낼 수 없습니다.' }, 400);
    }
    try {
      await sendSMS(normalizeLocalPhone(phone), message);
    } catch (smsErr) {
      console.error('[admin-create-invoice] sms error:', String(smsErr));
      return jsonResp({ success: false, error: 'sms_failed', detail: String(smsErr) }, 500);
    }

    console.log(`[admin-create-invoice] user=${userId} amount=${amount} sms_sent token=${token}`);
    return jsonResp({
      success: true,
      data: { token, url, amount, message_preview: message, sms_sent: true, phone },
    }, 200);
  } catch (e) {
    console.error('[admin-create-invoice] unhandled:', String(e));
    return jsonResp({ success: false, error: 'unhandled', detail: String(e) }, 500);
  }
});
