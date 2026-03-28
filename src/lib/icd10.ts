/**
 * Curated ICD-10 codes for common conditions seen in primary-care and general-practice settings.
 * Covers top diagnoses in Indian ambulatory care across 15 clinical categories.
 * Each entry: [code, short description]
 */

export interface Icd10Entry {
  code:  string
  label: string
}

const ICD10_LIST: Icd10Entry[] = [
  // Respiratory
  { code: 'J06.9',  label: 'Acute upper respiratory infection, unspecified' },
  { code: 'J00',    label: 'Acute nasopharyngitis (common cold)' },
  { code: 'J02.9',  label: 'Acute pharyngitis, unspecified' },
  { code: 'J03.9',  label: 'Acute tonsillitis, unspecified' },
  { code: 'J18.9',  label: 'Pneumonia, unspecified' },
  { code: 'J20.9',  label: 'Acute bronchitis, unspecified' },
  { code: 'J45.9',  label: 'Asthma, unspecified' },
  { code: 'J11.1',  label: 'Influenza with respiratory manifestations' },
  { code: 'J30.1',  label: 'Allergic rhinitis due to pollen' },
  { code: 'J30.4',  label: 'Allergic rhinitis, unspecified' },
  { code: 'J32.9',  label: 'Chronic sinusitis, unspecified' },

  // Gastrointestinal
  { code: 'K29.7',  label: 'Gastritis, unspecified' },
  { code: 'K21.0',  label: 'Gastroesophageal reflux with esophagitis' },
  { code: 'K21.9',  label: 'Gastroesophageal reflux without esophagitis' },
  { code: 'K59.0',  label: 'Constipation' },
  { code: 'K58.9',  label: 'Irritable bowel syndrome without diarrhea' },
  { code: 'A09',    label: 'Acute gastroenteritis and colitis' },
  { code: 'K30',    label: 'Functional dyspepsia' },
  { code: 'K57.30', label: 'Diverticulosis of large intestine' },
  { code: 'K80.20', label: 'Calculus of gallbladder without cholecystitis' },

  // Cardiovascular
  { code: 'I10',    label: 'Essential hypertension' },
  { code: 'I25.10', label: 'Atherosclerotic heart disease of native coronary artery' },
  { code: 'I20.9',  label: 'Angina pectoris, unspecified' },
  { code: 'I48.91', label: 'Atrial fibrillation, unspecified' },
  { code: 'I50.9',  label: 'Heart failure, unspecified' },
  { code: 'I63.9',  label: 'Cerebral infarction, unspecified' },
  { code: 'I73.9',  label: 'Peripheral vascular disease, unspecified' },

  // Endocrine / Metabolic
  { code: 'E11.9',  label: 'Type 2 diabetes mellitus without complications' },
  { code: 'E11.65', label: 'Type 2 diabetes mellitus with hyperglycemia' },
  { code: 'E10.9',  label: 'Type 1 diabetes mellitus without complications' },
  { code: 'E78.5',  label: 'Hyperlipidemia, unspecified' },
  { code: 'E78.00', label: 'Pure hypercholesterolemia' },
  { code: 'E03.9',  label: 'Hypothyroidism, unspecified' },
  { code: 'E05.90', label: 'Thyrotoxicosis, unspecified' },
  { code: 'E66.9',  label: 'Obesity, unspecified' },
  { code: 'E61.1',  label: 'Iron deficiency without anemia' },
  { code: 'D50.9',  label: 'Iron deficiency anemia, unspecified' },
  { code: 'E55.9',  label: 'Vitamin D deficiency, unspecified' },

  // Musculoskeletal
  { code: 'M54.5',  label: 'Low back pain' },
  { code: 'M54.2',  label: 'Cervicalgia (neck pain)' },
  { code: 'M79.3',  label: 'Panniculitis' },
  { code: 'M06.9',  label: 'Rheumatoid arthritis, unspecified' },
  { code: 'M19.90', label: 'Osteoarthritis, unspecified' },
  { code: 'M81.0',  label: 'Age-related osteoporosis without fracture' },
  { code: 'M79.7',  label: 'Fibromyalgia' },
  { code: 'M75.1',  label: 'Rotator cuff syndrome' },
  { code: 'M47.816', label: 'Spondylosis of lumbar region without myelopathy' },

  // Neurological
  { code: 'G43.909', label: 'Migraine, unspecified, not intractable' },
  { code: 'G44.309', label: 'Post-traumatic headache, unspecified' },
  { code: 'G47.00', label: 'Insomnia, unspecified' },
  { code: 'G47.10', label: 'Hypersomnia, unspecified' },
  { code: 'R51',    label: 'Headache' },
  { code: 'G62.9',  label: 'Polyneuropathy, unspecified' },
  { code: 'G40.909', label: 'Epilepsy, unspecified, not intractable' },

  // Mental health
  { code: 'F32.9',  label: 'Major depressive disorder, single episode, unspecified' },
  { code: 'F41.1',  label: 'Generalized anxiety disorder' },
  { code: 'F41.9',  label: 'Anxiety disorder, unspecified' },
  { code: 'F10.10', label: 'Alcohol abuse, uncomplicated' },
  { code: 'F51.01', label: 'Primary insomnia' },

  // Genitourinary
  { code: 'N39.0',  label: 'Urinary tract infection, site not specified' },
  { code: 'N40.0',  label: 'Benign prostatic hyperplasia without lower urinary tract symptoms' },
  { code: 'N92.0',  label: 'Excessive and frequent menstruation with regular cycle' },
  { code: 'N94.6',  label: 'Dysmenorrhea, unspecified' },
  { code: 'N18.9',  label: 'Chronic kidney disease, unspecified' },
  { code: 'N20.0',  label: 'Calculus of kidney' },

  // Skin
  { code: 'L50.0',  label: 'Allergic urticaria' },
  { code: 'L20.9',  label: 'Atopic dermatitis, unspecified' },
  { code: 'L30.9',  label: 'Dermatitis, unspecified' },
  { code: 'L40.0',  label: 'Psoriasis vulgaris' },
  { code: 'B35.1',  label: 'Tinea unguium (onychomycosis)' },
  { code: 'B35.4',  label: 'Tinea corporis (ringworm)' },
  { code: 'L70.0',  label: 'Acne vulgaris' },

  // Infections
  { code: 'A90',    label: 'Dengue fever (classical dengue)' },
  { code: 'B50.9',  label: 'Plasmodium falciparum malaria, unspecified' },
  { code: 'A01.0',  label: 'Typhoid fever' },
  { code: 'B19.9',  label: 'Unspecified viral hepatitis' },
  { code: 'B24',    label: 'HIV disease, unspecified' },
  { code: 'A15.0',  label: 'Tuberculosis of lung' },
  { code: 'A37.90', label: 'Whooping cough, unspecified' },
  { code: 'B05.9',  label: 'Measles without complication' },

  // Eye
  { code: 'H10.9',  label: 'Conjunctivitis, unspecified' },
  { code: 'H52.4',  label: 'Presbyopia' },
  { code: 'H26.9',  label: 'Cataract, unspecified' },
  { code: 'H40.9',  label: 'Glaucoma, unspecified' },

  // Ear
  { code: 'H66.90', label: 'Otitis media, unspecified, unspecified ear' },
  { code: 'H60.9',  label: 'Otitis externa, unspecified' },
  { code: 'H91.90', label: 'Hearing loss, unspecified, unspecified ear' },

  // Obstetric (common presentations)
  { code: 'Z34.90', label: 'Normal pregnancy supervision, unspecified' },
  { code: 'O10.02', label: 'Pre-existing essential hypertension complicating pregnancy' },
  { code: 'O24.410', label: 'Gestational diabetes in pregnancy' },

  // Symptoms / Unclassified
  { code: 'R05',    label: 'Cough' },
  { code: 'R50.9',  label: 'Fever, unspecified' },
  { code: 'R07.9',  label: 'Chest pain, unspecified' },
  { code: 'R10.9',  label: 'Unspecified abdominal pain' },
  { code: 'R55',    label: 'Syncope and collapse' },
  { code: 'R00.0',  label: 'Tachycardia, unspecified' },
  { code: 'R06.0',  label: 'Dyspnoea' },
  { code: 'R11.2',  label: 'Nausea with vomiting, unspecified' },
  { code: 'R11.0',  label: 'Nausea' },
  { code: 'R42',    label: 'Dizziness and giddiness' },
  { code: 'R68.89', label: 'Other specified general symptoms and signs' },
]

/**
 * Fuzzy search over ICD-10 entries.
 * Searches both code and label, case-insensitive.
 * Returns up to `limit` results.
 */
export function searchIcd10(query: string, limit = 8): Icd10Entry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  return ICD10_LIST
    .filter((e) =>
      e.code.toLowerCase().includes(q) ||
      e.label.toLowerCase().includes(q)
    )
    .slice(0, limit)
}

/** Returns the label for a given ICD-10 code, or the code itself if not found */
export function icd10Label(code: string): string {
  return ICD10_LIST.find((e) => e.code === code)?.label ?? code
}
