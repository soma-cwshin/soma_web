-- soma production — 명함 체험 가입 데일리 대시보드용 RPC
-- Edge Function subs-trial-dashboard 에서 service_role 로 호출

CREATE OR REPLACE FUNCTION public.subs_trial_dashboard(
  p_since timestamptz DEFAULT TIMESTAMPTZ '2026-08-10 00:00:00+09'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH new_centers AS (
    SELECT c.id, c.name, c.created_at, c.address, c.contact_number, c.is_registered
    FROM centers c
    WHERE c.created_at >= p_since
  ),
  trainers AS (
    SELECT
      ucr.center_id,
      u.id AS user_id,
      u.name AS user_name,
      ucr.created_at AS joined_at,
      row_number() OVER (PARTITION BY ucr.center_id ORDER BY ucr.created_at ASC, u.name ASC) AS rn
    FROM user_center_roles ucr
    JOIN users u ON u.id = ucr.user_id
    WHERE ucr.role::text = 'trainer'
      AND ucr.center_id IN (SELECT id FROM new_centers)
  ),
  trainer_subs AS (
    SELECT DISTINCT ON (t.user_id)
      t.user_id,
      t.center_id,
      t.user_name,
      t.joined_at,
      t.rn,
      s.id AS subscription_id,
      s.is_trial,
      s.status AS sub_status,
      s.plan_type,
      s.start_date AS trial_start,
      s.end_date AS trial_end
    FROM trainers t
    LEFT JOIN subscriptions s ON s.user_id = t.user_id
    ORDER BY t.user_id, s.is_trial DESC NULLS LAST, s.created_at DESC NULLS LAST
  ),
  center_metrics AS (
    SELECT
      c.id AS center_id,
      (
        SELECT count(*)::int
        FROM members m
        JOIN user_center_roles ucr ON ucr.id = m.user_center_role_id
        WHERE ucr.center_id = c.id
      ) AS member_registrations,
      (
        SELECT count(*)::int
        FROM bookings b
        WHERE b.center_id = c.id
          AND b.status::text <> 'cancelled'
      ) AS booking_count,
      (
        SELECT count(*)::int
        FROM ai_analysis_batches a
        WHERE a.center_id = c.id
          AND a.status = 'completed'
      ) AS ai_report_count,
      (
        SELECT count(*)::int
        FROM ai_analysis_batches a
        WHERE a.center_id = c.id
      ) AS ai_report_total,
      (
        SELECT count(*)::int
        FROM trainers t
        WHERE t.center_id = c.id
      ) AS trainer_count
    FROM new_centers c
  ),
  rows AS (
    SELECT
      c.id AS center_id,
      c.name AS center_name,
      c.created_at AS center_created_at,
      c.address,
      c.contact_number,
      coalesce(c.is_registered, false) AS is_registered,
      pt.user_id,
      pt.user_name,
      pt.joined_at AS user_joined_at,
      coalesce(pt.is_trial, false) AS is_trial,
      pt.sub_status,
      pt.plan_type,
      pt.trial_start,
      pt.trial_end,
      CASE
        WHEN pt.trial_start IS NULL THEN NULL
        ELSE greatest(0, extract(epoch FROM (now() - pt.trial_start)))
      END AS elapsed_seconds,
      CASE
        WHEN pt.trial_end IS NULL THEN NULL
        ELSE extract(epoch FROM (pt.trial_end - now()))
      END AS remaining_seconds,
      cm.member_registrations,
      cm.booking_count,
      cm.ai_report_count,
      cm.ai_report_total,
      cm.trainer_count,
      (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'userId', ts.user_id,
            'userName', ts.user_name,
            'joinedAt', ts.joined_at,
            'isTrial', coalesce(ts.is_trial, false),
            'subStatus', ts.sub_status,
            'planType', ts.plan_type,
            'trialStart', ts.trial_start,
            'trialEnd', ts.trial_end
          ) ORDER BY ts.rn
        ), '[]'::jsonb)
        FROM trainer_subs ts
        WHERE ts.center_id = c.id
      ) AS trainers
    FROM new_centers c
    LEFT JOIN trainer_subs pt ON pt.center_id = c.id AND pt.rn = 1
    LEFT JOIN center_metrics cm ON cm.center_id = c.id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'since', p_since,
    'generatedAt', now(),
    'summary', jsonb_build_object(
      'centerCount', (SELECT count(*)::int FROM rows),
      'activeTrialCount', (SELECT count(*)::int FROM rows WHERE is_trial AND sub_status = 'active' AND trial_end > now()),
      'memberRegistrations', (SELECT coalesce(sum(member_registrations),0)::int FROM rows),
      'bookingCount', (SELECT coalesce(sum(booking_count),0)::int FROM rows),
      'aiReportCount', (SELECT coalesce(sum(ai_report_count),0)::int FROM rows)
    ),
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(r) - 'trainers' || jsonb_build_object('trainers', r.trainers)
        ORDER BY r.center_created_at DESC)
      FROM rows r
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.subs_trial_dashboard(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subs_trial_dashboard(timestamptz) TO service_role;
