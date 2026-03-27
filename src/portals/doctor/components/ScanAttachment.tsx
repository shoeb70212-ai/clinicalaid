import { useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

interface Attachment {
  id:        string
  file_path: string
  publicUrl: string
}

interface Props {
  clinicId:      string
  queueEntryId:  string
  patientId:     string
  uploadedBy:    string   // staff id
  disabled?:     boolean
}

const MAX_SIDE_PX    = 1920  // max dimension after resize
const MAX_BYTES      = 1_048_576  // 1 MB JPEG target
const ALLOWED_TYPES  = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * Camera capture → Canvas compress → Supabase Storage upload.
 * No OCR — raw image stored as immutable visual record.
 * Storage path: {clinicId}/prescriptions/{queueEntryId}/{uuid}.jpg
 */
export function ScanAttachment({ clinicId, queueEntryId, patientId, uploadedBy, disabled }: Props) {
  const inputRef              = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading,   setUploading]   = useState(false)
  const [progress,    setProgress]    = useState(0)
  const [error,       setError]       = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset so the same file can be re-selected if needed
    e.target.value = ''

    if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) {
      setError('Only JPEG, PNG, or WebP images are allowed.')
      return
    }

    setUploading(true)
    setProgress(10)
    setError(null)

    try {
      const blob  = await compressImage(file)
      setProgress(40)

      const uuid     = crypto.randomUUID()
      const filePath = `${clinicId}/prescriptions/${queueEntryId}/${uuid}.jpg`

      const { error: uploadError } = await supabase.storage
        .from('clinic-attachments')
        .upload(filePath, blob, { contentType: 'image/jpeg', upsert: false })

      if (uploadError) throw new Error(uploadError.message)
      setProgress(75)

      // Insert metadata row
      const { error: insertError } = await supabase
        .from('queue_attachments')
        .insert({
          clinic_id:      clinicId,
          queue_entry_id: queueEntryId,
          patient_id:     patientId,
          file_path:      filePath,
          file_type:      'prescription_scan',
          mime_type:      'image/jpeg',
          file_size:      blob.size,
          uploaded_by:    uploadedBy,
        })

      if (insertError) throw new Error(insertError.message)
      setProgress(100)

      // Get public URL for thumbnail
      const { data: urlData } = supabase.storage
        .from('clinic-attachments')
        .getPublicUrl(filePath)

      setAttachments((prev) => [
        ...prev,
        { id: uuid, file_path: filePath, publicUrl: urlData.publicUrl },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }

  function removeLocal(id: string) {
    // Removes from local display only — does not delete from storage
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Upload button */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-[#164e63] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Camera className="h-3.5 w-3.5" aria-hidden="true" />
        {uploading ? 'Uploading…' : 'Scan Paper Rx'}
      </button>

      {/* Hidden file input — opens rear camera on mobile */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
        aria-label="Capture prescription scan"
      />

      {/* Progress bar */}
      {uploading && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-[#0891b2] transition-all duration-300"
            style={{ width: `${progress}%` }}
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <p role="alert" className="text-xs text-red-600">{error}</p>
      )}

      {/* Thumbnails */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div key={a.id} className="group relative">
              <a
                href={a.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open scanned prescription"
              >
                <img
                  src={a.publicUrl}
                  alt="Scanned prescription"
                  className="h-16 w-16 rounded-lg border border-gray-200 object-cover transition-opacity hover:opacity-80"
                />
              </a>
              <button
                type="button"
                onClick={() => removeLocal(a.id)}
                aria-label="Remove thumbnail"
                className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-red-500 text-white group-hover:flex"
              >
                <X className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Image compression helpers ─────────────────────────────────────────────────

async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = scaleDimensions(bitmap.width, bitmap.height)

  const canvas = document.createElement('canvas')
  canvas.width  = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  // Try quality from 0.85 down until under MAX_BYTES
  for (const quality of [0.85, 0.75, 0.65, 0.55]) {
    const blob = await canvasToBlob(canvas, quality)
    if (blob.size <= MAX_BYTES) return blob
  }
  // Return lowest quality if still over limit
  return canvasToBlob(canvas, 0.45)
}

function scaleDimensions(w: number, h: number): { width: number; height: number } {
  if (w <= MAX_SIDE_PX && h <= MAX_SIDE_PX) return { width: w, height: h }
  const ratio = Math.min(MAX_SIDE_PX / w, MAX_SIDE_PX / h)
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
      'image/jpeg',
      quality
    )
  })
}
