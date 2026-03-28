-- Migration 014: Analytics helper RPCs for the reception analytics dashboard.
-- All RPCs are SECURITY DEFINER and filter strictly by p_clinic_id.

-- ── get_daily_stats ────────────────────────────────────────────────────────────
-- Returns per-day patient counts and revenue for the last N days.
CREATE OR REPLACE FUNCTION get_daily_stats(p_clinic_id UUID, p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  day            DATE,
  total_patients INTEGER,
  completed      INTEGER,
  no_shows       INTEGER,
  revenue_paise  BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    q.day,
    COUNT(*)                                                    AS total_patients,
    COUNT(*) FILTER (WHERE q.status = 'COMPLETED')             AS completed,
    COUNT(*) FILTER (WHERE q.status = 'NO_SHOW')               AS no_shows,
    COALESCE(SUM(py.amount_paise) FILTER (WHERE py.status = 'paid'), 0) AS revenue_paise
  FROM (
    SELECT
      qe.id,
      qe.status,
      DATE(s.opened_at) AS day
    FROM queue_entries qe
    JOIN sessions s ON s.id = qe.session_id
    WHERE qe.clinic_id = p_clinic_id
      AND DATE(s.opened_at) >= CURRENT_DATE - (p_days || ' days')::INTERVAL
  ) q
  LEFT JOIN payments py ON py.queue_entry_id = q.id AND py.clinic_id = p_clinic_id
  GROUP BY q.day
  ORDER BY q.day;
$$;

GRANT EXECUTE ON FUNCTION get_daily_stats(UUID, INTEGER) TO authenticated;

-- ── get_top_diagnoses ──────────────────────────────────────────────────────────
-- Top chief complaints from visits (rough diagnosis proxy) for last N days.
CREATE OR REPLACE FUNCTION get_top_diagnoses(p_clinic_id UUID, p_days INTEGER DEFAULT 30, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  complaint TEXT,
  count     BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    LOWER(TRIM(chief_complaint)) AS complaint,
    COUNT(*) AS count
  FROM visits
  WHERE clinic_id = p_clinic_id
    AND chief_complaint IS NOT NULL
    AND chief_complaint <> ''
    AND visit_date >= CURRENT_DATE - (p_days || ' days')::INTERVAL
  GROUP BY LOWER(TRIM(chief_complaint))
  ORDER BY count DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_top_diagnoses(UUID, INTEGER, INTEGER) TO authenticated;

-- ── get_top_drugs ──────────────────────────────────────────────────────────────
-- Most prescribed drugs for last N days.
CREATE OR REPLACE FUNCTION get_top_drugs(p_clinic_id UUID, p_days INTEGER DEFAULT 30, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  drug_name TEXT,
  count     BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pr.drug_name,
    COUNT(*) AS count
  FROM prescriptions pr
  JOIN visits v ON v.id = pr.visit_id
  WHERE pr.clinic_id = p_clinic_id
    AND v.visit_date >= CURRENT_DATE - (p_days || ' days')::INTERVAL
  GROUP BY pr.drug_name
  ORDER BY count DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_top_drugs(UUID, INTEGER, INTEGER) TO authenticated;
