# ClinicFlow — Claude Code Master Guide

---

## SYSTEM IDENTITY

```
Product     : ClinicFlow
Version     : V1 (MVP)
Stack       : React (Vite) + Tailwind CSS + Supabase Managed Cloud (Mumbai)
Database    : PostgreSQL 15 with Row Level Security
Realtime    : Supabase WAL-based WebSockets
Auth        : Supabase Auth — email + password + TOTP for doctors
Hosting     : Supabase Managed Cloud ap-south-1 (Mumbai) — DPDP compliant
```

---

## CURRENT BUILD SCOPE

```
ACTIVE_VERSION = "V1"
```

| Feature | V1 | V2 |
|---|---|---|
| Queue management | ✅ BUILD | — |
| Staff auth + TOTP | ✅ BUILD | — |
| Patient basic profile | ✅ BUILD | — |
| DPDP consent capture | ✅ BUILD | — |
| Realtime sync (all portals) | ✅ BUILD | — |
| OCC conflict resolution | ✅ BUILD | — |
| Audit logging (DB trigger) | ✅ BUILD | — |
| TV display portal | ✅ BUILD | — |
| Onboarding wizard | ✅ BUILD | — |
| White-label theming | ✅ BUILD | — |
| Basic payments (cash/UPI flag only) | ✅ BUILD | — |
| End-of-day Z-Report (basic) | ✅ BUILD | — |
| CDSCO banned drug hard block | ✅ BUILD | — |
| Patient instruction i18n dictionary | ✅ BUILD | — |
| Staff invite flow | ✅ BUILD | — |
| Drug DB (3-tier, offline batch) | ✅ BUILD | — |
| Rapid mode (solo doctor) | ✅ BUILD | — |
| Identity verification (amber lock) | ✅ BUILD | — |
| Multi-language UI (i18next) | ✅ BUILD | — |
| Patient kiosk + OTP check-in | ❌ DEFER | ✅ V2 |
| Full medical records (visits table) | ❌ DEFER | ✅ V2 |
| Prescription PDF generation | ❌ DEFER | ✅ V2 |
| Appointment booking + calendar | ❌ DEFER | ✅ V2 |
| Razorpay online payments | ❌ DEFER | ✅ V2 |
| SMS / WhatsApp notifications | ❌ DEFER | ✅ V2 |
| Voice-to-text (Whisper local) | ❌ DEFER | ✅ V2 |
| OCR lab report scanning | ❌ DEFER | ✅ V2 |
| Patient recall engine | ❌ DEFER | ✅ V2 |
| Intelligence VPS (AI layer) | ❌ DEFER | ✅ V2 |
| ABHA integration | ❌ DEFER | ✅ V2 |
| Full analytics + reporting | ❌ DEFER | ✅ V2 |
| Native wrapper (Android/iOS/Desktop) | ❌ DEFER | ✅ V2 |

> If marked ❌ DEFER — do not write a single line of code for it.
> V2 hooks (empty stubs, reserved routes, schema columns) ARE allowed where marked.

---

## PORTALS

```
/setup       → Onboarding wizard (unauthenticated, first-run only)
/reception   → Reception portal (role: receptionist, admin)
/doctor      → Doctor portal (role: doctor, admin — TOTP required)
/display     → TV display (role: display — scoped JWT, zero PII)
```

> V2 reserved — return 404 "Coming Soon" if accessed:
> /kiosk, /patient, /admin-dashboard

---

## CLINIC MODES

```
SOLO  → Single doctor. No receptionist. Rapid mode. QR auto-provisioned.
TEAM  → Doctor + receptionist. Standard queue. Staff invite required.
```

Stored as `clinic_mode ENUM('solo','team')` on `clinics` table.
Check this flag at runtime — never hardcode mode-specific logic.

---

## REFERENCE DOCS

Read the relevant doc BEFORE writing any code for that domain.

| Domain | Doc | Status |
|---|---|---|
| Architecture decisions | docs/01-decisions.md | V1 |
| Database schema + SQL | docs/02-schema.md | V1 |
| Queue state machine | docs/03-state-machine.md | V1 |
| Realtime sync + OCC | docs/04-realtime.md | V1 |
| Auth + roles + security | docs/05-auth.md | V1 |
| Legal compliance | docs/06-compliance.md | V1 |
| Storage architecture | docs/07-storage.md | V1 |
| Rapid mode (solo doctor) | docs/08-rapid-mode.md | V1 |
| Patient profile UI | docs/09-patient-profile.md | V1 |
| PDF prescriptions | docs/10-pdf-prescriptions.md | V2 spec — do not build |
| Drug database (3-tier) | docs/11-drug-database.md | V1 |
| Offline mode + sync | docs/12-offline-mode.md | V1 |
| Onboarding wizard | docs/13-onboarding.md | V1 |
| V2 full roadmap | docs/V2-roadmap.md | Reference only |

---

## NON-NEGOTIABLE RULES

### 1. Multi-Tenancy
- EVERY table: `clinic_id UUID NOT NULL REFERENCES clinics(id)`
- EVERY RLS policy: both `USING` AND `WITH CHECK` — no exceptions
- NEVER filter by clinic_id in application code — RLS enforces at DB layer
- New table: clinic_id + RLS FIRST, nothing else until verified
- EVERY staff RLS policy: `AND is_active = TRUE` — fired staff lose access immediately

### 2. Timestamps — DB is the only clock
- NEVER use `new Date()` or client-side timestamp in DB write payloads
- ALL state-change timestamps set by PostgreSQL BEFORE UPDATE trigger via `NOW()`
- Client OCC payload contains ONLY: `{ status, version }` — nothing else
- Always `RETURNING *` on OCC updates — gets trigger-set timestamps back instantly

### 3. OCC (Optimistic Concurrency Control)
```sql
UPDATE queue_entries
SET status = $newStatus, version = version + 1
WHERE id = $id AND version = $currentVersion
RETURNING *;
```
- `rows_affected = 0` → conflict → re-fetch → re-render → no user-facing error
- All queue mutations go through `src/lib/occ.ts` — no raw Supabase calls on queue_entries

### 4. Queue State Machine
- NEVER allow transition not in docs/03-state-machine.md
- Enforce in `src/lib/transitions.ts` AND at DB constraint level
- `identity_verified = TRUE` required before IN_CONSULTATION
- COMPLETED and CANCELLED are terminal — zero transitions out, ever

### 5. Patient Data
- NEVER hard-delete a patient row — erasure = anonymization only
- NEVER store Aadhaar numbers
- Mobile number is NOT unique — always return array on lookup
- Consent row inserted in same DB transaction as patient row

### 6. Audit Logging
- NEVER add application-level audit logging for queue_entries
- PostgreSQL trigger fires automatically
- `staff_id` read from JWT claims inside trigger — no extra DB lookup
- audit_logs: INSERT and SELECT only — no UPDATE or DELETE, ever

### 7. Security
- Display portal: scoped JWT `role: display` — never anon key
- Inactivity logout: BroadcastChannel API across tabs — never single-tab timer
- Login: max 5 failed attempts → 15-minute lockout
- Sentry: scrub PII from all error payloads

### 8. DPDP Compliance
- Consent: full legal text — not "I agree to terms"
- Consent version check before EVERY queue entry creation
- `export_patient_data` RPC must exist — DPDP Section 11
- No patient PII to any third-party service

### 9. Clinical Safety
- CDSCO banned drugs: hard UI block — no bypass, no override
- Drug names: ALWAYS English capitals — NMC mandate
- Patient dosage instructions: local language from `drug_instructions_i18n`
- Schedule X drugs: hard block — cannot be prescribed digitally
- AI suggestions: read-only chips — doctor must tap to accept, never auto-applied

### 10. White-Label Theming
- `primary_color` mapped ONLY to: primary buttons, active tab underline, sidebar highlight
- WCAG AA contrast validated before saving — reject non-compliant colours
- Backgrounds, text, borders always neutral — never clinic colour

---

## FILE STRUCTURE

```
src/
├── portals/
│   ├── reception/
│   ├── doctor/
│   ├── display/
│   └── setup/
├── components/shared/
├── hooks/
│   ├── useQueue.ts
│   ├── useSession.ts
│   └── useAuth.ts
├── lib/
│   ├── supabase.ts        ← single instance
│   ├── occ.ts             ← all queue mutations
│   ├── transitions.ts     ← state machine guard
│   ├── voice.ts           ← V2 stub (empty)
│   └── ocr.ts             ← V2 stub (empty)
├── types/
│   └── index.ts           ← all DB types + enums
└── i18n/
    ├── index.ts
    └── locales/
        ├── en.json
        ├── hi.json
        ├── mr.json
        └── ta.json
```

---

## BUILD ORDER

Do not start step N+1 until step N is verified passing.

| Step | What to Build | Verification |
|---|---|---|
| 1 | Supabase schema + all RLS | Two fake clinic JWTs — zero cross-tenant leakage |
| 2 | Auth + JWT Edge Function | clinic_id, role, staff_id in claims |
| 3 | Realtime subscription test | 3 tabs, direct DB write → all update <200ms |
| 4 | Onboarding wizard (/setup) | Solo + team flows, clinic_mode saved |
| 5 | Staff invite flow | Invite → signup → correct role + clinic |
| 6 | Reception portal — queue panel | Live queue, patient add, session controls |
| 7 | OCC + conflict test | Two simultaneous writes — one wins, one re-syncs |
| 8 | Doctor portal | Call next, complete, quick notes, amber lock |
| 9 | TV display | Scoped JWT, queue_display_sync, no PII, <200ms |
| 10 | Audit trigger | Direct DB write creates audit row with staff_id |
| 11 | Basic payments + Z-Report | Cash/UPI flag, fee, end-of-day summary |
| 12 | Drug DB + search | Starter pack, pg_trgm, banned drug block |
| 13 | i18n + instruction dictionary | UI translated, dosage in regional language |
| 14 | White-label theming | Logo upload, colour picker + contrast validation |
| 15 | Multi-tenant stress test | 2 clinics, simultaneous — zero leakage |

---

## V2 HOOKS (add in V1, activate in V2)

| Hook | Type | V2 Purpose |
|---|---|---|
| `visits` table | Schema only | Full medical records |
| `appointments` table | Schema only | Appointment booking |
| `kiosk_checkins` table | Schema only | OTP kiosk flow |
| `analytics_events` table | Schema only | Intelligence VPS feed |
| `clinic_pin_code` column | Column on clinics | Outbreak radar |
| `abha_id` column | Column on patients | ABHA integration |
| `recall_engine_enabled` | clinics.config JSONB | Patient recall CRM |
| `drug_interactions_enabled` | clinics.config JSONB | Interaction alerts |
| `/kiosk` route | Reserved route | OTP kiosk |
| `/patient` route | Reserved route | Patient portal |
| `onVoiceInput()` | Empty function in voice.ts | Whisper ASR |
| `onScanLabReport()` | Empty function in ocr.ts | Tesseract OCR |

---

## DEFINITION OF DONE — V1

V1 is complete when ALL of the following pass:

1. New clinic created via /setup — solo and team mode both work
2. Doctor (TOTP) and receptionist accounts with correct roles
3. Receptionist opens session — doctor portal shows active session
4. Three patients added — tokens generated with zero duplicates under concurrent add
5. Live queue visible in reception, doctor, and TV simultaneously
6. Doctor + receptionist click Call simultaneously — OCC resolves, no corruption
7. Unverified QR patient — amber lock, inputs disabled until Confirm Identity
8. Doctor marks COMPLETED — Z-Report shows correct count and cash total
9. CDSCO banned drug — hard block, prescription cannot be finalised
10. Dosage instruction renders in patient's regional language
11. Patient erasure — PII anonymized, clinical structure retained
12. Staff `is_active = FALSE` — next request denied immediately
13. Two clinic instances — zero cross-tenant data visible
14. All audit_log rows have non-null staff_id
15. Realtime updates on all portals within 200ms of DB write

> Tests 6, 12, 13, 14 are the go/no-go criteria.

<!-- VERCEL BEST PRACTICES START -->
## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If Enable Deployment Protection is enabled, use a bypass secret to directly access them
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl https://ai-gateway.vercel.sh/v1/models first; never trust model IDs from memory
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access
<!-- VERCEL BEST PRACTICES END -->
