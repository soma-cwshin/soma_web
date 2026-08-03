-- 일반 청구(수납 전용) 링크 테이블
--
-- 구독과 무관하게 임의 금액을 청구·수납하기 위한 링크.
-- 기존 payment_links / subscriptions 는 전혀 건드리지 않는 별도 테이블이다.
-- 결제가 완료돼도 구독은 생성·연장되지 않는다.
--
-- 접근: RLS 활성 + 정책 없음 → service_role(Edge Function)만 접근 가능.

create table if not exists public.invoice_links (
  id                 uuid primary key default gen_random_uuid(),
  token              text not null unique,
  user_id            uuid not null references public.users(id) on delete cascade,
  order_name         text not null,                       -- 청구 항목명 (결제창 orderName)
  amount             integer not null check (amount > 0),  -- 청구 금액(원)
  memo               text,                                 -- 관리자 메모(회원에게 노출 안 함)
  status             text not null default 'pending'
                       check (status in ('pending', 'paid', 'cancelled')),
  portone_payment_id text,
  created_by         uuid,                                 -- 링크 생성 관리자
  expires_at         timestamptz not null,
  paid_at            timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists invoice_links_user_created_idx
  on public.invoice_links (user_id, created_at desc);

create index if not exists invoice_links_status_idx
  on public.invoice_links (status);

-- 동일 PortOne 결제건이 두 청구서에 붙는 것을 DB 레벨에서 차단
create unique index if not exists invoice_links_portone_payment_id_key
  on public.invoice_links (portone_payment_id)
  where portone_payment_id is not null;

alter table public.invoice_links enable row level security;

comment on table public.invoice_links is
  '일반 청구(수납 전용) 링크. 결제 완료 시 subscriptions 를 생성/연장하지 않는다.';
