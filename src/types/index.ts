// ─── Enums (mirror PostgreSQL enums) ────────────────────────────────────────

export type StaffRole      = 'admin' | 'doctor' | 'receptionist'
export type SessionStatus  = 'open' | 'paused' | 'closed'
export type ClinicMode     = 'solo' | 'team'
export type QueueStatus    =
  | 'CHECKED_IN'
  | 'CALLED'
  | 'IN_CONSULTATION'
  | 'COMPLETED'
  | 'NO_SHOW'
  | 'SKIPPED'
  | 'CANCELLED'
export type QueueType      = 'appointment' | 'walk_in'
export type QueueSource    = 'reception' | 'qr_kiosk' | 'doctor_rapid'
export type PaymentStatus  = 'pending' | 'paid' | 'waived'
export type PaymentMode    = 'cash' | 'upi'
export type SyncStatus     = 'synced' | 'pending'

// ─── Database row types ──────────────────────────────────────────────────────

export interface Clinic {
  id:               string
  name:             string
  address:          string | null
  phone:            string | null
  email:            string | null
  registration_no:  string | null
  clinic_mode:      ClinicMode
  primary_color:    string
  logo_url:         string | null
  clinic_pin_code:  string | null   // V2 hook
  config:           ClinicConfig
  is_active:        boolean
  created_at:       string
}

export interface ClinicConfig {
  recall_engine_enabled:      boolean
  drug_interactions_enabled:  boolean
  consent_version:            string
  avg_consultation_seconds:   number
  languages:                  string[]
}

export interface Staff {
  id:             string
  clinic_id:      string
  user_id:        string | null
  name:           string
  email:          string
  role:           StaffRole
  specialty:      string | null
  reg_number:     string | null
  is_active:      boolean
  totp_required:  boolean
  created_at:     string
}

export interface StaffInvite {
  id:          string
  clinic_id:   string
  email:       string
  role:        StaffRole
  token:       string
  expires_at:  string
  used_at:     string | null
  created_by:  string
  created_at:  string
}

export interface ConsentTemplate {
  id:         string
  clinic_id:  string | null
  version:    string
  language:   string
  content:    string
  is_active:  boolean
  created_at: string
}

export interface Patient {
  id:                  string
  clinic_id:           string
  name:                string
  dob:                 string | null
  gender:              'male' | 'female' | 'other' | 'prefer_not_to_say' | null
  mobile:              string
  address:             string | null
  blood_group:         string | null
  emergency_name:      string | null
  emergency_phone:     string | null
  preferred_language:  string
  abha_id:             string | null  // V2 hook
  is_anonymized:       boolean
  anonymized_at:       string | null
  created_at:          string
}

export interface PatientConsent {
  id:               string
  patient_id:       string
  clinic_id:        string
  consent_text:     string
  consent_version:  string
  consented_at:     string
  ip_address:       string | null
  captured_by:      string | null
  is_withdrawn:     boolean
  withdrawn_at:     string | null
  withdrawn_by:     string | null
}

export interface Session {
  id:                          string
  clinic_id:                   string
  doctor_id:                   string
  date:                        string
  status:                      SessionStatus
  opened_at:                   string
  closed_at:                   string | null
  avg_consultation_seconds:    number
}

export interface SessionCounter {
  session_id:   string
  clinic_id:    string
  token_count:  number
}

export interface QueueEntry {
  id:                       string
  clinic_id:                string
  session_id:               string
  patient_id:               string
  token_number:             number
  token_prefix:             string
  type:                     QueueType
  source:                   QueueSource
  status:                   QueueStatus
  version:                  number
  identity_verified:        boolean
  notes:                    string | null
  sync_status:              SyncStatus
  created_at:               string
  called_at:                string | null
  consultation_started_at:  string | null
  completed_at:             string | null
}

export interface QueueDisplaySync {
  session_id:     string
  clinic_id:      string
  current_token:  string | null
  next_token:     string | null
  status:         string | null
  updated_at:     string
}

export interface Payment {
  id:                    string
  clinic_id:             string
  queue_entry_id:        string
  patient_id:            string
  amount_paise:          number
  method:                PaymentMode
  status:                PaymentStatus
  collected_by:          string | null
  version:               number
  razorpay_order_id:     string | null  // V2 hook
  razorpay_payment_id:   string | null  // V2 hook
  razorpay_signature:    string | null  // V2 hook
  created_at:            string
  paid_at:               string | null
}

export interface MasterDrug {
  id:           string
  name:         string
  generic_name: string | null
  category:     string | null
  schedule:     string | null   // H, H1, X, OTC
  is_banned:    boolean
  ban_date:     string | null
  ban_reason:   string | null
  created_at:   string
  updated_at:   string
}

export interface DoctorDrugPreference {
  id:               string
  clinic_id:        string
  doctor_id:        string
  drug_name:        string
  generic_name:     string | null
  category:         string | null
  usage_count:      number
  default_dosage:   string | null
  default_duration: number | null
  default_timing:   string | null
  is_from_master:   boolean
  master_drug_id:   string | null
  sync_status:      SyncStatus
  updated_at:       string
}

export interface CustomClinicDrug {
  id:                  string
  clinic_id:           string
  doctor_id:           string | null
  drug_name:           string
  usage_count:         number
  flagged_for_review:  boolean
  created_at:          string
}

export interface DrugInstructionI18n {
  id:           string
  dosage_code:  string
  timing_code:  string
  language:     string
  instruction:  string
}

export interface AuditLog {
  id:          number
  clinic_id:   string
  staff_id:    string | null
  action:      string
  table_name:  string
  record_id:   string
  old_value:   Record<string, unknown> | null
  new_value:   Record<string, unknown> | null
  ip_address:  string | null
  created_at:  string
}

// ─── JWT Claims (from Supabase JWT enrichment) ───────────────────────────────

export interface JwtClaims {
  sub:            string
  email:          string
  role:           StaffRole | 'display'
  clinic_id:      string
  staff_id:       string
  totp_required:  boolean
  exp:            number
  // Display-only fields
  session_id?: string
}

// ─── Application-level types ─────────────────────────────────────────────────

/** Queue entry enriched with patient data for portal display */
export interface QueueEntryWithPatient extends QueueEntry {
  patient: Pick<Patient, 'id' | 'name' | 'dob' | 'gender' | 'mobile' | 'blood_group' | 'preferred_language'>
}

/** Drug search result — source indicates which tier it came from */
export interface DrugSearchResult {
  drug_name:        string
  generic_name:     string | null
  category:         string | null
  schedule:         string | null
  is_banned:        boolean
  is_from_master:   boolean
  default_dosage:   string | null
  default_duration: number | null
  default_timing:   string | null
  source:           'batch' | 'master' | 'custom'
}

/** Banned drug check result */
export interface BannedCheck {
  banned:   boolean
  date?:    string
  reason?:  string
}

/** OCC operation result */
export interface OCCResult {
  success:  boolean
  reason?:  'conflict' | 'error'
  data?:    QueueEntry
}

/** Z-Report data for end-of-day summary */
export interface ZReport {
  session_id:      string
  total_patients:  number
  completed:       number
  no_shows:        number
  cash_paise:      number
  upi_paise:       number
}

/** Rapid consultation RPC result */
export interface RapidConsultationResult {
  queue_entry_id:  string | null
  patient_id:      string | null
  token_number:    number | null
  is_new_patient:  boolean
  family_members:  FamilyMember[] | null
  needs_reconsent?: boolean
}

export interface FamilyMember {
  id:   string
  name: string
  dob:  string | null
}

/** Auth session state */
export interface AuthState {
  session:      import('@supabase/supabase-js').Session | null
  staff:        Staff | null
  clinic:       Clinic | null
  role:         StaffRole | 'display' | null
  totpRequired: boolean
  mfaVerified:  boolean
  loading:      boolean
}

/** Single item in a prescription (used in draft and DB) */
export interface PrescriptionItem {
  drug_name:     string
  generic_name?: string
  dosage:        string    // e.g. '1-0-1'
  duration_days: number
  timing?:       string    // 'after_food' | 'before_food' | 'empty_stomach' | 'sos'
}

/** Prescription row from the prescriptions table */
export interface Prescription {
  id:            string
  visit_id:      string
  clinic_id:     string
  drug_name:     string
  generic_name:  string | null
  dosage:        string
  duration_days: number
  timing:        string | null
  created_at:    string
}

/** Visit row from the visits table */
export interface Visit {
  id:                 string
  clinic_id:          string
  patient_id:         string
  queue_entry_id:     string | null
  doctor_id:          string
  visit_date:         string
  chief_complaint:    string | null
  examination_notes:  string | null
  diagnosis:          string | null
  icd10_code:         string | null
  bp_systolic:        number | null
  bp_diastolic:       number | null
  pulse:              number | null
  temperature:        number | null
  spo2:               number | null
  weight:             number | null
  follow_up_date:     string | null
  created_at:         string
  prescriptions?:     Prescription[]
}

/** Consultation draft saved to localStorage */
export interface ConsultationDraft {
  queueEntryId:    string
  chiefComplaint:  string
  quickNotes:      string
  vitals: {
    bp_systolic:   string
    bp_diastolic:  string
    temperature:   string
    spo2:          string
    pulse:         string
    weight:        string
  }
  prescriptionItems?: PrescriptionItem[]
  savedAt: number
}
