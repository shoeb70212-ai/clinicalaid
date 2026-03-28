-- Migration 013: Patient Recall Engine
-- Identifies patients whose prescription period has elapsed and who
-- haven't returned for a follow-up visit within the recall window.

-- get_recall_due RPC — returns patients due for recall for a given clinic.
-- A patient appears when:
--   1. Their most recent visit has prescriptions
--   2. visit_date + max(duration_days) <= today  (medication course finished)
--   3. That due date is within the last 30 days   (avoid surfacing ancient recalls)
--   4. No subsequent visit exists for the patient
CREATE OR REPLACE FUNCTION get_recall_due(p_clinic_id UUID)
RETURNS TABLE (
  visit_id          UUID,
  patient_id        UUID,
  patient_name      TEXT,
  patient_mobile    TEXT,
  visit_date        DATE,
  chief_complaint   TEXT,
  max_duration_days INTEGER,
  recall_due_date   DATE,
  days_overdue      INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id                                                                 AS visit_id,
    v.patient_id,
    p.name                                                               AS patient_name,
    p.mobile                                                             AS patient_mobile,
    v.visit_date,
    v.chief_complaint,
    rx_agg.max_duration_days,
    (v.visit_date + rx_agg.max_duration_days * INTERVAL '1 day')::DATE  AS recall_due_date,
    (CURRENT_DATE - (v.visit_date + rx_agg.max_duration_days * INTERVAL '1 day')::DATE) AS days_overdue
  FROM visits v
  JOIN patients p
    ON p.id = v.patient_id
   AND p.is_anonymized = FALSE
   AND p.clinic_id = p_clinic_id
  JOIN (
    SELECT pr.visit_id, MAX(pr.duration_days) AS max_duration_days
    FROM prescriptions pr
    GROUP BY pr.visit_id
  ) rx_agg ON rx_agg.visit_id = v.id
  WHERE
    v.clinic_id = p_clinic_id
    -- Most recent visit for this patient (no newer visit exists)
    AND NOT EXISTS (
      SELECT 1 FROM visits v2
      WHERE v2.patient_id = v.patient_id
        AND v2.clinic_id  = v.clinic_id
        AND v2.visit_date > v.visit_date
    )
    -- Recall due date has arrived
    AND (v.visit_date + rx_agg.max_duration_days * INTERVAL '1 day')::DATE <= CURRENT_DATE
    -- Only within last 30 days (avoid showing very old recalls)
    AND (v.visit_date + rx_agg.max_duration_days * INTERVAL '1 day')::DATE >= CURRENT_DATE - INTERVAL '30 days'
  ORDER BY recall_due_date ASC;
$$;

GRANT EXECUTE ON FUNCTION get_recall_due(UUID) TO authenticated;
