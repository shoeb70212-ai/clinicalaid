/**
 * Lab report scanning helpers.
 *
 * V1 approach:
 *   - Camera capture → compressed JPEG → Supabase Storage (lab-reports/ path)
 *   - Doctor manually enters / voice-dictates key findings into labFindings field
 *   - See ScanAttachment (mode="lab") and EncounterForm section 5
 *
 * V2 upgrade path:
 *   - Replace this stub with a cloud vision API call (e.g. Google Vision, AWS Textract)
 *   - Feed the storage URL; get back structured JSON of lab values
 *   - Pre-populate the labFindings field for doctor review
 */

/** V2 stub — server-side OCR extraction from a lab report image URL */
export function onScanLabReport(_fileUrl: string): Promise<string> {
  // V2: call cloud vision RPC here and return extracted text
  return Promise.resolve('')
}
