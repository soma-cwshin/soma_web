-- soma production: maps_center_marker_stats 에 앱 구독 여부 추가
CREATE OR REPLACE FUNCTION public.maps_center_marker_stats(p_center_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH kst AS (
    SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS today,
           ((now() AT TIME ZONE 'Asia/Seoul')::date - 1) AS yesterday,
           ((now() AT TIME ZONE 'Asia/Seoul')::date - 2) AS day_before
  ),
  booking_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE (b.created_at AT TIME ZONE 'Asia/Seoul')::date = k.yesterday) AS cnt_yesterday,
      COUNT(*) FILTER (WHERE (b.created_at AT TIME ZONE 'Asia/Seoul')::date = k.day_before) AS cnt_day_before,
      COUNT(*) AS cnt_total
    FROM bookings b
    CROSS JOIN kst k
    WHERE b.center_id = p_center_id
  ),
  trainer_sub AS (
    SELECT MAX(s.end_date) AS max_expires
    FROM user_center_roles ucr
    JOIN subscriptions s ON s.user_id = ucr.user_id
    WHERE ucr.center_id = p_center_id
      AND ucr.role = 'trainer'
      AND s.end_date IS NOT NULL
  ),
  active_sub AS (
    SELECT EXISTS (
      SELECT 1
      FROM user_center_roles ucr
      JOIN subscriptions s ON s.user_id = ucr.user_id
      WHERE ucr.center_id = p_center_id
        AND ucr.role = 'trainer'
        AND s.status = 'active'
        AND (
          s.end_date IS NULL
          OR (s.end_date AT TIME ZONE 'Asia/Seoul')::date >= (SELECT today FROM kst)
        )
    ) AS subscribed
  )
  SELECT jsonb_build_object(
    'bookingTotal', (SELECT cnt_total FROM booking_counts),
    'bookingDelta', (SELECT cnt_yesterday - cnt_day_before FROM booking_counts),
    'trainerSubExpiresMax', (SELECT max_expires FROM trainer_sub),
    'isSubscribed', COALESCE((SELECT subscribed FROM active_sub), false)
  );
$$;
