# Storage Architecture — V1

Supabase Storage (S3-compatible) running on Supabase Managed Mumbai.
Same data residency as database. Separate RLS system from table RLS.
Table RLS gives zero protection to storage — storage needs its own policies.

---

## Bucket Structure

```
clinic-docs/
└── {clinic_id}/
    ├── logos/
    │   └── logo.{png|jpg}          ← clinic logo for white-labelling
    └── documents/
        └── {patient_id}/
            └── {filename}          ← V2: lab reports, referral letters
```

> V2 will add: `{clinic_id}/prescriptions/{patient_id}/{visit_id}.pdf`
> Reserve this path. Do not create it in V1.

---

## Bucket Configuration

```sql
-- Create bucket with native size + MIME enforcement (no Edge Function needed)
INSERT INTO storage.buckets (id, name, file_size_limit, allowed_mime_types, public)
VALUES (
  'clinic-docs',
  'clinic-docs',
  10485760,  -- 10MB per file
  ARRAY['image/jpeg','image/png','image/webp','application/pdf'],
  false      -- never public
);
```

---

## Storage RLS Policies

Storage RLS is on `storage.objects` — completely separate from table RLS.
A misconfigured table RLS has zero effect on storage access.

```sql
-- Clinic staff can read files in their own clinic folder only
CREATE POLICY "clinic_staff_read" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'clinic-docs'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'clinic_id')
  );

-- Clinic staff can upload files to their own clinic folder only
CREATE POLICY "clinic_staff_upload" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'clinic-docs'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'clinic_id')
    AND (storage.foldername(name))[2] IN ('logos','documents')
  );

-- Clinic staff can delete files in their own clinic folder
CREATE POLICY "clinic_staff_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'clinic-docs'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'clinic_id')
  );

-- No public access policy — bucket is private
-- Display role JWT cannot access storage at all
```

**Note:** Folder structure uses bare UUID as root, not `clinic-{uuid}`.
`(storage.foldername(name))[1]` returns the first folder segment.
If root is `{clinic_id}/documents/file.pdf`, first segment = clinic UUID. Matches JWT claim directly.

---

## Logo Upload (White-Labelling)

```typescript
// src/lib/storage.ts

export async function uploadClinicLogo(
  clinicId: string,
  file: File
): Promise<string> {
  // Validate MIME before upload
  const allowed = ['image/jpeg','image/png','image/webp'];
  if (!allowed.includes(file.type)) {
    throw new Error('Logo must be JPG, PNG, or WebP');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('Logo must be under 2MB');
  }

  const path = `${clinicId}/logos/logo.${file.type.split('/')[1]}`;

  const { error } = await supabase.storage
    .from('clinic-docs')
    .upload(path, file, { upsert: true });

  if (error) throw error;

  const { data } = supabase.storage
    .from('clinic-docs')
    .getPublicUrl(path);

  // Save URL to clinics table
  await supabase
    .from('clinics')
    .update({ logo_url: data.publicUrl })
    .eq('id', clinicId);

  return data.publicUrl;
}
```

---

## Data Residency Verification

Supabase Managed Cloud ap-south-1 (Mumbai) stores all files on AWS Mumbai infrastructure.
No S3 env var configuration needed — managed cloud handles this.

**Verification checklist:**
- Supabase project region shows `ap-south-1` in dashboard
- No `STORAGE_S3_ENDPOINT` or `STORAGE_S3_REGION` environment variable points outside India
- Storage bucket list in Supabase dashboard shows bucket is in the Mumbai project

---

## File Access Pattern (Signed URLs)

Never expose storage file URLs directly. Always use short-lived signed URLs.

```typescript
// Generate signed URL for temporary access (e.g., viewing a document)
const { data, error } = await supabase.storage
  .from('clinic-docs')
  .createSignedUrl(`${clinicId}/documents/${patientId}/${filename}`, 300); // 5 min expiry
```

---

## DPDP File Erasure (Path B — V2 when prescriptions exist)

When a patient invokes DPDP Section 12 erasure right:

1. DB anonymization runs first (see docs/06-compliance.md)
2. All files under `{clinic_id}/documents/{patient_id}/` are listed and hard-deleted
3. V2: All files under `{clinic_id}/prescriptions/{patient_id}/` are listed and hard-deleted
4. Database clinical records are retained (NMC compliance)
5. Physical files containing burned-in PII are destroyed (DPDP compliance)

```typescript
// V2 erasure helper (schema ready, implementation deferred)
async function deletePatientFiles(clinicId: string, patientId: string) {
  const { data: files } = await supabase.storage
    .from('clinic-docs')
    .list(`${clinicId}/documents/${patientId}`);

  if (files && files.length > 0) {
    const paths = files.map(f => `${clinicId}/documents/${patientId}/${f.name}`);
    await supabase.storage.from('clinic-docs').remove(paths);
  }
}
```

---

## What NOT to Store in V1

- Patient photos (not collected in V1)
- Prescription PDFs (V2 feature)
- Lab report images (V2 feature)
- Audio recordings (V2 — voice-to-text handled client-side anyway)
- Doctor signature SVG (stored encrypted in DB, not storage, for security)
