-- soma production (qbreoqkdusrrobilwidk) — maps 영업 지도 조회용 RPC
-- Edge Function maps-center-insights 에서 service_role 로 호출

CREATE OR REPLACE FUNCTION public.maps_center_match(
  p_name text,
  p_address text DEFAULT '',
  p_phone text DEFAULT ''
)
RETURNS TABLE (
  center_id uuid,
  center_name text,
  center_address text,
  contact_number text,
  is_registered boolean,
  registered_at timestamptz,
  match_score integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH norm AS (
    SELECT
      lower(regexp_replace(coalesce(p_name, ''), '\s+', '', 'g')) AS n_name,
      lower(regexp_replace(regexp_replace(coalesce(p_address, ''), '\s+\d+\s*층.*$', ''), '[^a-z0-9가-힣]', '', 'g')) AS n_addr,
      regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') AS n_phone
  ), scored AS (
    SELECT
      c.id,
      c.name,
      c.address,
      c.contact_number,
      c.is_registered,
      c.created_at,
      (
        CASE
          WHEN lower(regexp_replace(c.name, '\s+', '', 'g')) = (SELECT n_name FROM norm) THEN 100
          WHEN c.name ILIKE '%' || p_name || '%' OR p_name ILIKE '%' || c.name || '%' THEN 60
          ELSE 0
        END
        + CASE
          WHEN (SELECT n_addr FROM norm) <> '' AND c.address IS NOT NULL
            AND lower(regexp_replace(regexp_replace(c.address, '\s+\d+\s*층.*$', ''), '[^a-z0-9가-힣]', '', 'g'))
              LIKE '%' || left((SELECT n_addr FROM norm), 12) || '%'
          THEN 30
          ELSE 0
        END
        + CASE
          WHEN (SELECT n_phone FROM norm) <> '' AND c.contact_number IS NOT NULL
            AND regexp_replace(c.contact_number, '[^0-9]', '', 'g') = (SELECT n_phone FROM norm)
          THEN 40
          ELSE 0
        END
      )::integer AS score
    FROM centers c
  )
  SELECT id, name, address, contact_number, is_registered, created_at, score
  FROM scored
  WHERE score >= 40
  ORDER BY score DESC, created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.maps_center_match(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.maps_center_match(text, text, text) TO service_role;

-- bookingActivity, staffPlans, memberPasses, people 를 center_id 기준으로 반환
