import { supabase } from './supabase'
import type { DrugSearchResult, BannedCheck } from '../types'

/** Escape special ILIKE pattern characters to prevent incorrect search results. */
function escapeLike(q: string): string {
  return q.replace(/[%_\\]/g, '\\$&')
}

/**
 * 3-tier drug search:
 *   1. Doctor's local batch (fast, offline-capable)
 *   2. master_drugs cloud fuzzy search (online only)
 *   3. custom_clinic_drugs sandbox (online only)
 *
 * Source: docs/11-drug-database.md
 */
export async function searchDrugs(
  query: string,
  doctorId: string,
  clinicId: string,
  isOnline: boolean,
): Promise<DrugSearchResult[]> {
  if (!query.trim()) return []

  // Step 1: Doctor's batch — always first, fast, offline-capable
  const { data: batchResults } = await supabase
    .from('doctor_drug_preferences')
    .select('drug_name, generic_name, category, default_dosage, default_duration, default_timing, is_from_master')
    .eq('doctor_id', doctorId)
    .eq('clinic_id', clinicId)
    .ilike('drug_name', `%${escapeLike(query)}%`)
    .order('usage_count', { ascending: false })
    .limit(10)

  if (batchResults && batchResults.length > 0) {
    return batchResults.map((r) => ({
      drug_name:        r.drug_name,
      generic_name:     r.generic_name,
      category:         r.category,
      schedule:         null,
      is_banned:        false,
      is_from_master:   r.is_from_master,
      default_dosage:   r.default_dosage,
      default_duration: r.default_duration,
      default_timing:   r.default_timing,
      source:           'batch' as const,
    }))
  }

  if (!isOnline) return []

  // Step 2: Master drugs (cloud fuzzy search via pg_trgm)
  const [masterRes, customRes] = await Promise.all([
    supabase
      .from('master_drugs')
      .select('name, generic_name, category, schedule, is_banned')
      .ilike('name', `%${escapeLike(query)}%`)
      .order('name')
      .limit(10),
    supabase
      .from('custom_clinic_drugs')
      .select('drug_name')
      .eq('clinic_id', clinicId)
      .ilike('drug_name', `%${escapeLike(query)}%`)
      .limit(5),
  ])

  const results: DrugSearchResult[] = [
    ...(masterRes.data ?? []).map((r) => ({
      drug_name:        r.name,
      generic_name:     r.generic_name,
      category:         r.category,
      schedule:         r.schedule,
      is_banned:        r.is_banned,
      is_from_master:   true,
      default_dosage:   null,
      default_duration: null,
      default_timing:   null,
      source:           'master' as const,
    })),
    ...(customRes.data ?? []).map((r) => ({
      drug_name:        r.drug_name,
      generic_name:     null,
      category:         null,
      schedule:         null,
      is_banned:        false,
      is_from_master:   false,
      default_dosage:   null,
      default_duration: null,
      default_timing:   null,
      source:           'custom' as const,
    })),
  ]

  return results
}

/**
 * Hard-check a drug name against the CDSCO banned list.
 * Called on every drug selection — result must be shown if banned = true.
 * Cannot be bypassed.
 */
export async function checkBannedDrug(drugName: string): Promise<BannedCheck> {
  const { data } = await supabase
    .from('master_drugs')
    .select('is_banned, ban_date, ban_reason')
    .ilike('name', drugName)
    .maybeSingle()

  if (data?.is_banned) {
    return { banned: true, date: data.ban_date ?? undefined, reason: data.ban_reason ?? undefined }
  }
  return { banned: false }
}

/**
 * Increment usage count + update default dosage pattern after doctor confirms a drug.
 * The learning engine that powers smart pre-fill.
 */
export async function recordDrugUsage(
  clinicId: string,
  doctorId: string,
  drugName: string,
  dosage: string | null,
  duration: number | null,
  timing: string | null,
): Promise<void> {
  await supabase.from('doctor_drug_preferences').upsert(
    {
      clinic_id:        clinicId,
      doctor_id:        doctorId,
      drug_name:        drugName,
      usage_count:      1,
      default_dosage:   dosage,
      default_duration: duration,
      default_timing:   timing,
    },
    {
      onConflict:        'doctor_id,drug_name',
      ignoreDuplicates:  false,
    },
  )
}
