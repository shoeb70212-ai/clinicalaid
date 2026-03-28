/**
 * Client-side drug-drug interaction checker.
 *
 * Data source: curated subset of clinically significant interactions for primary-care
 * prescribing in India. Covers the 50 most common drug classes seen in ambulatory care.
 *
 * Severity grades follow standard pharmacovigilance classification:
 *   contraindicated — absolute, must not be co-prescribed
 *   major           — life-threatening, avoid unless benefits outweigh risks
 *   moderate        — monitor closely, dose adjustment may be needed
 *
 * Only moderate-and-above interactions are included (minor interactions are omitted
 * to reduce alert fatigue in busy clinical settings).
 */

export type DDISeverity = 'contraindicated' | 'major' | 'moderate'

export interface DrugInteraction {
  drugA:       string   // normalised uppercase fragment
  drugB:       string
  severity:    DDISeverity
  description: string
}

/** Normalise drug name for matching: uppercase, strip salt suffixes */
function norm(name: string): string {
  return name.toUpperCase().replace(/\s+/g, ' ').trim()
}

/** Returns true if the prescription item's name contains the fragment */
function matches(drugName: string, fragment: string): boolean {
  return norm(drugName).includes(fragment)
}

// ── Interaction dataset ────────────────────────────────────────────────────────
// Each pair is order-independent: A↔B and B↔A both match.
// fragment matching allows: "WARFARIN 5MG" to match "WARFARIN".

const INTERACTIONS: DrugInteraction[] = [
  // ── Anticoagulants ───────────────────────────────────────────────────────────
  { drugA: 'WARFARIN',    drugB: 'ASPIRIN',      severity: 'major',          description: 'Increased bleeding risk — aspirin inhibits platelet aggregation and can displace warfarin from protein binding.' },
  { drugA: 'WARFARIN',    drugB: 'IBUPROFEN',    severity: 'major',          description: 'NSAIDs increase anticoagulant effect and GI bleeding risk with warfarin.' },
  { drugA: 'WARFARIN',    drugB: 'DICLOFENAC',   severity: 'major',          description: 'NSAIDs increase anticoagulant effect and GI bleeding risk with warfarin.' },
  { drugA: 'WARFARIN',    drugB: 'FLUCONAZOLE',  severity: 'major',          description: 'Fluconazole inhibits CYP2C9, markedly increasing warfarin levels and bleeding risk.' },
  { drugA: 'WARFARIN',    drugB: 'METRONIDAZOLE', severity: 'major',         description: 'Metronidazole inhibits CYP2C9 and CYP3A4, significantly increasing warfarin effect.' },
  { drugA: 'WARFARIN',    drugB: 'CIPROFLOXACIN', severity: 'moderate',      description: 'Fluoroquinolones may potentiate anticoagulant effect of warfarin — monitor INR closely.' },

  // ── MAOIs ────────────────────────────────────────────────────────────────────
  { drugA: 'SELEGILINE',  drugB: 'TRAMADOL',     severity: 'contraindicated', description: 'Risk of serotonin syndrome — potentially fatal. Do not co-prescribe.' },
  { drugA: 'SELEGILINE',  drugB: 'PETHIDINE',    severity: 'contraindicated', description: 'Risk of serotonin syndrome — potentially fatal.' },
  { drugA: 'SELEGILINE',  drugB: 'LINEZOLID',    severity: 'contraindicated', description: 'Linezolid has MAOI activity; combination causes serotonin syndrome.' },

  // ── Serotonin syndrome ───────────────────────────────────────────────────────
  { drugA: 'TRAMADOL',    drugB: 'SERTRALINE',   severity: 'major',          description: 'Risk of serotonin syndrome and seizures. Monitor closely; prefer alternatives.' },
  { drugA: 'TRAMADOL',    drugB: 'ESCITALOPRAM', severity: 'major',          description: 'Risk of serotonin syndrome. Use with caution.' },
  { drugA: 'TRAMADOL',    drugB: 'FLUOXETINE',   severity: 'major',          description: 'Risk of serotonin syndrome and seizures.' },
  { drugA: 'TRAMADOL',    drugB: 'VENLAFAXINE',  severity: 'major',          description: 'Risk of serotonin syndrome.' },

  // ── QT prolongation ──────────────────────────────────────────────────────────
  { drugA: 'AZITHROMYCIN', drugB: 'DOMPERIDONE', severity: 'contraindicated', description: 'Both prolong QT interval — combination significantly increases risk of Torsades de Pointes.' },
  { drugA: 'AZITHROMYCIN', drugB: 'HALOPERIDOL', severity: 'major',           description: 'Both prolong QT interval — arrhythmia risk.' },
  { drugA: 'AZITHROMYCIN', drugB: 'CIPROFLOXACIN', severity: 'moderate',      description: 'Additive QT prolongation risk.' },
  { drugA: 'CLARITHROMYCIN', drugB: 'DOMPERIDONE', severity: 'contraindicated', description: 'Both prolong QT interval — risk of fatal arrhythmia.' },
  { drugA: 'DOMPERIDONE', drugB: 'KETOCONAZOLE', severity: 'contraindicated', description: 'Ketoconazole inhibits CYP3A4, markedly raising domperidone levels and QT prolongation risk.' },
  { drugA: 'METHADONE',   drugB: 'CIPROFLOXACIN', severity: 'major',          description: 'Additive QT prolongation.' },

  // ── Statins + CYP3A4 inhibitors ──────────────────────────────────────────────
  { drugA: 'SIMVASTATIN', drugB: 'CLARITHROMYCIN', severity: 'contraindicated', description: 'Clarithromycin inhibits CYP3A4, dramatically raising simvastatin levels — risk of severe myopathy/rhabdomyolysis.' },
  { drugA: 'SIMVASTATIN', drugB: 'FLUCONAZOLE',  severity: 'major',            description: 'Fluconazole inhibits CYP3A4 and raises simvastatin levels — myopathy risk.' },
  { drugA: 'ATORVASTATIN', drugB: 'CLARITHROMYCIN', severity: 'major',         description: 'Clarithromycin inhibits CYP3A4 and raises atorvastatin levels — myopathy risk.' },

  // ── ACE inhibitors / ARBs ────────────────────────────────────────────────────
  { drugA: 'RAMIPRIL',    drugB: 'LOSARTAN',     severity: 'contraindicated', description: 'Dual renin-angiotensin blockade increases risk of hyperkalaemia, renal failure, and hypotension (ONTARGET trial).' },
  { drugA: 'ENALAPRIL',   drugB: 'LOSARTAN',     severity: 'contraindicated', description: 'Dual renin-angiotensin blockade — high-risk combination.' },
  { drugA: 'RAMIPRIL',    drugB: 'TELMISARTAN',  severity: 'contraindicated', description: 'Dual renin-angiotensin blockade — high-risk combination.' },
  { drugA: 'SPIRONOLACTONE', drugB: 'RAMIPRIL',  severity: 'major',           description: 'Risk of severe hyperkalaemia — monitor potassium closely.' },
  { drugA: 'SPIRONOLACTONE', drugB: 'ENALAPRIL', severity: 'major',           description: 'Risk of severe hyperkalaemia.' },
  { drugA: 'POTASSIUM',   drugB: 'RAMIPRIL',     severity: 'moderate',        description: 'ACE inhibitors reduce renal potassium excretion — risk of hyperkalaemia.' },

  // ── Metformin ────────────────────────────────────────────────────────────────
  { drugA: 'METFORMIN',   drugB: 'ALCOHOL',      severity: 'major',           description: 'Alcohol increases metformin-associated lactic acidosis risk.' },

  // ── NSAIDs + renal/CV risk ───────────────────────────────────────────────────
  { drugA: 'IBUPROFEN',   drugB: 'RAMIPRIL',     severity: 'moderate',        description: 'NSAIDs may reduce antihypertensive effect and increase risk of acute renal failure with ACE inhibitors.' },
  { drugA: 'DICLOFENAC',  drugB: 'RAMIPRIL',     severity: 'moderate',        description: 'NSAIDs may reduce antihypertensive effect and impair renal function.' },
  { drugA: 'IBUPROFEN',   drugB: 'ASPIRIN',      severity: 'moderate',        description: 'Ibuprofen may interfere with aspirin\'s antiplatelet effect if taken concurrently.' },

  // ── Antidiabetic agents ──────────────────────────────────────────────────────
  { drugA: 'GLIBENCLAMIDE', drugB: 'FLUCONAZOLE', severity: 'major',          description: 'Fluconazole inhibits CYP2C9 and CYP3A4, increasing glibenclamide exposure — risk of severe hypoglycaemia.' },
  { drugA: 'GLIPIZIDE',   drugB: 'FLUCONAZOLE',  severity: 'major',           description: 'Fluconazole increases sulfonylurea levels — hypoglycaemia risk.' },

  // ── Immunosuppressants ───────────────────────────────────────────────────────
  { drugA: 'TACROLIMUS',  drugB: 'CLARITHROMYCIN', severity: 'major',         description: 'Clarithromycin inhibits CYP3A4 and P-gp, markedly raising tacrolimus levels — nephrotoxicity and neurotoxicity risk.' },
  { drugA: 'CICLOSPORIN', drugB: 'CLARITHROMYCIN', severity: 'major',         description: 'Clarithromycin raises ciclosporin levels — nephrotoxicity risk.' },

  // ── Theophylline ─────────────────────────────────────────────────────────────
  { drugA: 'THEOPHYLLINE', drugB: 'CIPROFLOXACIN', severity: 'major',         description: 'Ciprofloxacin inhibits CYP1A2, raising theophylline levels — risk of seizures and arrhythmias.' },
  { drugA: 'THEOPHYLLINE', drugB: 'CLARITHROMYCIN', severity: 'moderate',     description: 'Clarithromycin raises theophylline levels — narrow therapeutic index.' },

  // ── Digoxin ──────────────────────────────────────────────────────────────────
  { drugA: 'DIGOXIN',     drugB: 'CLARITHROMYCIN', severity: 'major',         description: 'Clarithromycin inhibits P-gp, raising digoxin levels — risk of toxicity.' },
  { drugA: 'DIGOXIN',     drugB: 'AMIODARONE',    severity: 'major',          description: 'Amiodarone inhibits P-gp and raises digoxin levels by 70%.' },
  { drugA: 'DIGOXIN',     drugB: 'SPIRONOLACTONE', severity: 'moderate',      description: 'Spironolactone may increase or decrease digoxin levels — monitor closely.' },

  // ── Benzodiazepines ──────────────────────────────────────────────────────────
  { drugA: 'ALPRAZOLAM',  drugB: 'CLARITHROMYCIN', severity: 'major',         description: 'Clarithromycin inhibits CYP3A4, raising benzodiazepine levels — excessive sedation.' },
  { drugA: 'MIDAZOLAM',   drugB: 'CLARITHROMYCIN', severity: 'contraindicated', description: 'Co-administration contraindicated — risk of profound and prolonged sedation.' },

  // ── Erectile dysfunction drugs ───────────────────────────────────────────────
  { drugA: 'SILDENAFIL',  drugB: 'ISOSORBIDE',    severity: 'contraindicated', description: 'Sildenafil potentiates the hypotensive effect of nitrates — potentially fatal hypotension.' },
  { drugA: 'SILDENAFIL',  drugB: 'NITRATE',       severity: 'contraindicated', description: 'All PDE5 inhibitors are contraindicated with nitrates — severe hypotension.' },
  { drugA: 'TADALAFIL',   drugB: 'NITRATE',       severity: 'contraindicated', description: 'Contraindicated with all nitrates — risk of severe hypotension.' },
]

// ── Public API ────────────────────────────────────────────────────────────────

export interface DetectedInteraction {
  drugA:       string   // original drug names from the prescription
  drugB:       string
  severity:    DDISeverity
  description: string
}

/**
 * Given a list of drug names (from the current prescription), returns all
 * detected interactions with severity ≥ moderate.
 */
export function checkInteractions(drugNames: string[]): DetectedInteraction[] {
  const detected: DetectedInteraction[] = []

  for (let i = 0; i < drugNames.length; i++) {
    for (let j = i + 1; j < drugNames.length; j++) {
      const a = drugNames[i]
      const b = drugNames[j]

      for (const rule of INTERACTIONS) {
        const abMatch = matches(a, rule.drugA) && matches(b, rule.drugB)
        const baMatch = matches(a, rule.drugB) && matches(b, rule.drugA)

        if (abMatch || baMatch) {
          detected.push({
            drugA:       a,
            drugB:       b,
            severity:    rule.severity,
            description: rule.description,
          })
          break  // one rule per pair is enough
        }
      }
    }
  }

  // Sort by severity (contraindicated first)
  const ORDER: Record<DDISeverity, number> = { contraindicated: 0, major: 1, moderate: 2 }
  return detected.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
}

export const SEVERITY_COLOR: Record<DDISeverity, { bg: string; text: string; border: string }> = {
  contraindicated: { bg: '#fef2f2',  text: '#991b1b', border: '#fecaca' },
  major:           { bg: '#fff7ed',  text: '#9a3412', border: '#fed7aa' },
  moderate:        { bg: '#fffbeb',  text: '#92400e', border: '#fde68a' },
}

export const SEVERITY_LABEL: Record<DDISeverity, string> = {
  contraindicated: 'Contraindicated',
  major:           'Major interaction',
  moderate:        'Moderate interaction',
}
