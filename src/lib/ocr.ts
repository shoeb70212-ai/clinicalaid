/**
 * V2 stub — OCR lab report scanning.
 * V1 stores raw prescription images only (see ScanAttachment.tsx).
 * V2 feature: server-side OCR using cloud vision API. V1 stores raw image only.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function onScanLabReport(_file: File): Promise<string> {
  return Promise.reject(new Error('Lab report OCR is not available in V1'))
}
