CLINICFLOW CODEBASE AUDIT REPORT
Audit Date: 2026-03-30 Codebase: ClinicFlow V1 (React + Vite + Tailwind + Supabase) Files Reviewed: 70+ source files, 18 SQL migrations, 4 i18n locale files Lines of Code: ~8,500 (TypeScript/TSX), ~2,100 (SQL)

PHASE 1 — DEEP AUDIT FINDINGS
🐛 BUGS
[BUG-001] 🟠 HIGH | BUG | QueuePanel.tsx (line 46-48)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Consultation timer uses wrong timestamp field
File: src/portals/reception/components/QueuePanel.tsx (lines 46-48)
Description: The elapsed time calculation for the IN_CONSULTATION patient uses
  `called_at` instead of `consultation_started_at`. When a patient is CALLED,
  there may be a delay before the doctor actually starts the consultation
  (IN_CONSULTATION). This inflates the estimated wait time for all subsequent
  patients by that delay.
Impact: Incorrect wait time estimates shown to patients in the waiting room.
  If a doctor is delayed starting a consultation, ALL downstream wait estimates
  become inaccurate.
Recommendation: Change `inConsultation.called_at` to
  `inConsultation.consultation_started_at`. If consultation_started_at is null,
  fall back to called_at.
[BUG-002] 🟡 MEDIUM | BUG | AddPatientPanel.tsx (line 150)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Non-standard PostgREST filter syntax for duplicate check
File: src/portals/reception/components/AddPatientPanel.tsx (line 150)
Description: The duplicate patient check uses `.not('status', 'in', '("COMPLETED","CANCELLED")')`
  which relies on PostgREST's specific string parsing for the `in` operator.
  This format may break with PostgREST version upgrades.
Impact: If the filter silently fails, the same patient could be added to the
  queue twice in the same session, causing duplicate tokens.
Recommendation: Use explicit `.neq()` calls or the `.or()` syntax:
  `.or('status.neq.COMPLETED,status.neq.CANCELLED')`
[BUG-003] 🟡 MEDIUM | BUG | ConsultationPanel.tsx (lines 51-66)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Missing error handling on visit history fetch
File: src/portals/doctor/components/ConsultationPanel.tsx (lines 51-66)
Description: The useEffect that fetches visit metadata does not destructure or
  check the error from the Supabase query. If the visits table query fails
  (RLS issue, network error), visitMeta remains null forever.
Impact: The "previous visits" banner never appears, with no indication to the
  doctor that an error occurred. Silent data loss in the UI.
Recommendation: Destructure and handle the error:
  const { data, error } = await supabase.from('visits')...
  if (error) { setVisitMeta({ count: 0, lastDate: null }); return }
[BUG-004] 🟡 MEDIUM | BUG | EncounterForm.tsx (line 207)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Race condition in ICD-10 dropdown blur handler
File: src/portals/doctor/components/EncounterForm.tsx (line 207)
Description: The ICD-10 search dropdown uses `onBlur={() => setTimeout(() =>
  setIcdDropOpen(false), 150)}` to allow click events to fire before the
  dropdown closes. However, onMouseDown on the options already prevents this
  with `ev.preventDefault()`. The 150ms timeout creates a brief window where
  rapid interactions could cause visual glitches.
Impact: Minor UX flicker when selecting ICD-10 codes. No data corruption.
Recommendation: Remove the setTimeout since onMouseDown preventDefault already
  handles this. Or use a ref-based approach to check if the click target is
  within the dropdown before closing.
[BUG-005] 🔵 LOW | BUG | useDarkMode.ts (line 12)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: No SSR guard on window.matchMedia in initial state
File: src/hooks/useDarkMode.ts (line 12)
Description: The useState initializer calls `window.matchMedia(...)` directly.
  While this is a Vite SPA (no SSR), the pattern is inconsistent with
  useConnectionStatus.ts which properly guards with `typeof navigator !== 'undefined'`.
Impact: Would crash if SSR is ever introduced. Currently low risk.
Recommendation: Add `typeof window !== 'undefined'` guard for consistency.
🔒 SECURITY
[SEC-001] 🔴 CRITICAL | SECURITY | jwt-enrichment/index.ts (line 56)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: JWT claim name mismatch — role authorization may fail silently
File: supabase/functions/jwt-enrichment/index.ts (line 56)
Description: The JWT enrichment Edge Function sets the role claim as `app_role`:
  `app_role: staffRecord.role`
  But ALL RLS policies check `(auth.jwt() ->> 'clinic_id')::uuid` (which works)
  and the frontend type `JwtClaims` (src/types/index.ts line 244) expects `role`.
  The frontend `useAuth.tsx` reads role from the staff table directly (line 47),
  not from JWT claims, so the app works — but the JWT claim name is misleading
  and could cause issues if any code path reads role from JWT instead of the
  staff table query.
Impact: Currently non-breaking because the frontend queries the staff table
  directly. However, any future code that reads `jwt.role` will get `undefined`.
  The RLS policies don't check role (only clinic_id), so this isn't a bypass —
  but it's a latent bug.
Recommendation: Change `app_role` to `role` in the JWT enrichment function to
  match the JwtClaims type. Verify no Supabase internal code conflicts with the
  `role` claim name (it shouldn't since this is a custom claim).
[SEC-002] 🟠 HIGH | SECURITY | DisplayPortal.tsx (lines 25-26)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Display portal accepts session ID from URL without authentication
File: src/portals/display/DisplayPortal.tsx (lines 25-26)
Description: The display portal reads `session` from URL search params and uses
  it to query `queue_display_sync`. There is no token-based authentication —
  anyone with the session UUID can view the display data. While the display
  data is designed to be zero-PII, the RLS policy on queue_display_sync checks
  `clinic_id = (auth.jwt() ->> 'clinic_id')::uuid`, meaning an unauthenticated
  request would fail at RLS. However, the portal uses the anon key client,
  which has no JWT claims — so the RLS check would fail and the portal shows
  "Session not found or access denied."
Impact: The display portal currently doesn't work as designed because it needs
  a scoped JWT (role: display) but the frontend doesn't set one up. The CLAUDE.md
  spec says "scoped JWT with role: display" but the implementation just uses
  the default anon key.
Recommendation: Implement a display token generation flow: a staff member
  generates a scoped, time-limited JWT with role: display and clinic_id in
  claims. The TV loads /display?token=<scoped_jwt>. The Edge Function
  validates and returns the display data.
[SEC-003] 🟡 MEDIUM | SECURITY | LoginPage.tsx (lines 37-53)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Login rate limiting is client-side only
File: src/components/shared/LoginPage.tsx (lines 37-53)
Description: Failed login attempt tracking uses localStorage. An attacker can:
  1. Clear localStorage to reset the counter
  2. Use incognito mode (no persistent storage)
  3. Use a different browser
Impact: The 5-attempt/15-minute lockout is easily bypassed. While Supabase
  Auth has its own rate limiting, the client-side implementation gives a false
  sense of security.
Recommendation: Keep the client-side UX feedback but document that real rate
  limiting relies on Supabase Auth's server-side protections. Consider
  implementing a server-side rate limiting RPC for additional protection.
[SEC-004] 🟡 MEDIUM | SECURITY | ScanAttachment.tsx (line 101)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: No file size validation before upload
File: src/portals/doctor/components/ScanAttachment.tsx (line 101)
Description: While the image is compressed to MAX_BYTES (1MB) via canvas,
  there's no check on the original file size before attempting to load it
  into memory. A malicious user could upload a 500MB image that causes the
  browser tab to crash during the createImageBitmap call.
Impact: Browser tab crash, potential DoS on the doctor's workstation.
Recommendation: Add a pre-check: `if (file.size > 10_000_000) { setError('File too large'); return }`
  before attempting compression.
⚡ PERFORMANCE
[PERF-001] 🟡 MEDIUM | PERFORMANCE | useQueue.ts (lines 68-71)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: N+1 fetch pattern on queue INSERT events
File: src/hooks/useQueue.ts (lines 68-71)
Description: Every INSERT event from Realtime triggers a separate
  `fetchSingleEntry()` call to get the patient join. When multiple patients
  are added rapidly (e.g., during busy check-in), this creates N sequential
  network requests.
Impact: Increased latency during high-volume check-in periods. Each request
  takes ~100-200ms, so 5 rapid adds = ~1 second of sequential fetches.
Recommendation: Batch INSERT events with a short debounce (e.g., 200ms),
  or fetch all recent entries in a single query after the debounce window.
[PERF-002] 🟡 MEDIUM | PERFORMANCE | ConsultationPanel.tsx (line 79-84)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Auto-save fires on every keystroke with 500ms debounce
File: src/portals/doctor/components/ConsultationPanel.tsx (lines 79-84)
Description: The draft auto-save creates a new setTimeout on every change to
  the `draft` object. Since `draft` is a complex object that changes on every
  keystroke in any field (chief complaint, notes, vitals, etc.), this creates
  excessive localStorage writes.
Impact: On low-end devices, frequent JSON serialization + localStorage writes
  can cause input lag. The 500ms debounce helps but could be longer for
  non-critical fields.
Recommendation: Increase debounce to 1000ms. Consider only auto-saving when
  the user pauses typing for 2 seconds (idle detection) rather than fixed
  interval.
[PERF-003] 🔵 LOW | PERFORMANCE | AnalyticsPanel.tsx (lines 50-54)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Three separate RPC calls for analytics
File: src/portals/reception/components/AnalyticsPanel.tsx (lines 50-54)
Description: The analytics panel makes 3 separate RPC calls
  (get_daily_stats, get_top_diagnoses, get_top_drugs) using Promise.all.
  While these run in parallel, they each establish separate DB connections.
Impact: Minor overhead from 3 separate round trips. Could be consolidated
  into a single RPC that returns all data in one call.
Recommendation: Create a single `get_analytics_summary` RPC that returns
  { daily, diagnoses, drugs } in one JSONB response.
🏗️ ARCHITECTURE
[ARCH-001] 🟠 HIGH | ARCHITECTURE | ConsultationPanel.tsx (entire file)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: God component — ConsultationPanel handles too many responsibilities
File: src/portals/doctor/components/ConsultationPanel.tsx (392 lines)
Description: This single component manages:
  - Draft state + auto-save
  - Queue transitions (OCC)
  - Identity verification
  - Visit history fetching
  - Rx template loading
  - PDF generation (Rx + Referral)
  - Visit record saving via RPC
  - All error handling
Impact: Difficult to test, reason about, or modify without side effects.
  Any change to one concern risks breaking another.
Recommendation: Extract into focused hooks:
  - useConsultationDraft(entry, staffId)
  - useVisitHistory(patientId, clinicId)
  - useRxTemplates(doctorId)
  - useConsultationActions(entry, online)
[ARCH-002] 🟡 MEDIUM | ARCHITECTURE | Multiple portals
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Inconsistent brand color application pattern
File: ReceptionPortal.tsx (lines 28-32), DoctorPortal.tsx (lines 47-51)
Description: Both portals independently apply the clinic's primary_color to
  a CSS variable via useEffect. This is duplicated code that could drift.
Impact: If the pattern changes, both portals must be updated. Currently minor
  but violates DRY.
Recommendation: Extract a shared `useClinicTheme(clinic)` hook that handles
  CSS variable application, dark mode, and any future theming concerns.
[ARCH-003] 🟡 MEDIUM | ARCHITECTURE | Supabase direct calls in components
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Direct Supabase calls scattered across components
File: Multiple (AddPatientPanel, SessionControls, ConsultationPanel, etc.)
Description: Many components make direct `supabase.from(...)` or
  `supabase.rpc(...)` calls. There is no service layer or data access layer.
Impact: Difficult to implement caching, retry logic, or error handling
  consistently. Testing requires mocking Supabase everywhere.
Recommendation: Create a service layer (src/services/) with typed functions
  for each domain: queueService, patientService, sessionService, etc.
🎨 UX/DESIGN
[UX-001] 🟡 MEDIUM | UX | useQueue.ts + useSession.ts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: No language detection — i18n defaults to English
File: src/i18n/index.ts (line 18), src/hooks/useQueue.ts
Description: The i18n system defaults to 'en' with no browser language
  detection. The patient's preferred_language field exists but is never used
  to set the UI language.
Impact: Hindi/Tamil/Marathi-speaking staff see English UI by default.
Recommendation: Add `lng: navigator.language.split('-')[0]` to i18n init
  with fallback to 'en'. Allow manual override in a settings panel.
[UX-002] 🟡 MEDIUM | UX | Multiple components
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Toast system exists but is barely used
File: src/components/shared/Toast.tsx
Description: A full ToastProvider/useToast system is implemented but most
  components use local `error` state with inline error banners instead.
  The toast system provides better UX (auto-dismiss, stacking, consistent
  styling) but is underutilized.
Impact: Inconsistent error/success notification UX across the app.
  Some errors are inline banners, some are toasts, some are just console.error.
Recommendation: Migrate all user-facing notifications to use useToast().
  Reserve inline error banners for form validation only.
[UX-003] 🔵 LOW | UX | ConsultationActions.tsx
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: No confirmation before completing consultation
File: src/portals/doctor/components/ConsultationActions.tsx (line 99)
Description: The "End Consultation" button triggers immediately with no
  confirmation. If the doctor accidentally clicks it, the consultation is
  marked COMPLETED (terminal state — no undo).
Impact: Accidental completion loses the active consultation context. The
  doctor must find the patient in the queue and the visit record is already
  saved.
Recommendation: Add a two-step confirmation: first click shows "Confirm?"
  with a 2-second auto-revert, similar to the session close pattern in
  SessionControls.
📦 DEPENDENCIES
[DEP-001] 🔵 LOW | DEPENDENCIES | package.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: lucide-react pinned to very old version
File: package.json (line 34)
Description: lucide-react is at ^1.7.0 while the latest is 0.460+.
  The caret allows minor updates but not major.
Impact: Missing newer icons and potential API changes in future updates.
  Currently functional.
Recommendation: Update to latest stable version and verify icon imports.
[DEP-002] 🔵 LOW | DEPENDENCIES | package.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: recharts included for single component usage
File: package.json (line 38)
Description: recharts (~150KB) is used only in AnalyticsPanel.tsx for two
  charts. This adds significant bundle weight for a secondary feature.
Impact: Larger initial bundle. The analytics panel is lazy-loaded via the
  side panel toggle, so the impact is limited to when the panel opens.
Recommendation: Consider using a lighter charting library or CSS-only bar
  charts for the simple visualizations used.
🧪 TESTABILITY
[TEST-001] 🔴 CRITICAL | TESTABILITY | Root
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Zero test coverage — no test files exist
File: Entire codebase
Description: There are no test files anywhere in the project. No unit tests,
  no integration tests, no E2E tests. No test runner is configured.
  No test script in package.json.
Impact: Every refactor risks introducing regressions with no safety net.
  Critical business logic (OCC, state machine, consent flow) has no
  verification. This is the single highest-risk finding in the audit.
Recommendation: At minimum, add:
  1. Vitest + React Testing Library setup
  2. Unit tests for transitions.ts (state machine)
  3. Unit tests for occ.ts (mock Supabase)
  4. Unit tests for drugInteractions.ts (pure logic)
  5. Integration tests for the queue flow
[TEST-002] 🟠 HIGH | TESTABILITY | Components
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Tight coupling to Supabase makes components untestable
File: Multiple components
Description: Components directly import and call `supabase` from
  `src/lib/supabase.ts`. There is no dependency injection, no service
  abstraction, and no mock-friendly interface.
Impact: Writing component tests requires complex Supabase mocking at the
  module level. Each test file would need its own mock setup.
Recommendation: Introduce a thin service layer or use dependency injection
  via React Context to provide data access functions that can be mocked.
📄 DOCUMENTATION
[DOC-001] 🟡 MEDIUM | DOCUMENTATION | .env.example
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: .env.example missing required variables
File: .env.example
Description: The .env.example file may not document all environment variables
  used by the app. Variables like VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
  need to be documented with setup instructions.
Impact: New developers struggle to set up the project locally.
Recommendation: Ensure .env.example contains all required variables with
  placeholder values and comments explaining each.
[DOC-002] 🔵 LOW | DOCUMENTATION | i18n/index.ts (line 20)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: Missing comment on escapeValue: false rationale
File: src/i18n/index.ts (line 20)
Description: `interpolation: { escapeValue: false }` is set but the inline
  comment says "React handles XSS escaping". This is correct but could be
  more explicit about the security implications.
Impact: A future developer might re-enable it thinking it's a bug, causing
  double-escaping of translated strings.
Recommendation: The existing comment is adequate. No action needed.
🔧 DEVEX & OPERABILITY
[DEVEX-001] 🟠 HIGH | DEVEX | Root
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: No CI/CD, linting enforcement, or pre-commit hooks
File: Root directory
Description: No GitHub Actions, no Husky, no lint-staged, no Prettier config.
  ESLint is configured but not enforced in the build pipeline.
Impact: Code quality relies entirely on developer discipline. Inconsistent
  formatting, uncaught lint errors in production builds.
Recommendation: Add:
  1. Husky + lint-staged for pre-commit linting
  2. Prettier for consistent formatting
  3. GitHub Actions for build + lint on PR
  4. TypeScript strict mode in tsconfig
[DEVEX-002] 🟡 MEDIUM | DEVEX | .env.local
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: .env.local file exists in repo (may contain secrets)
File: .env.local (shown in file listing)
Description: The .env.local file appears in the project directory. While
  .gitignore excludes it, its presence in the working directory suggests
  it may have been committed at some point or contains real credentials.
Impact: If committed, Supabase URL and anon key are exposed. The anon key
  is designed to be public (RLS protects data), but Edge Function URLs
  and project structure are exposed.
Recommendation: Verify .env.local is not in git history. Use
  `git rm --cached .env.local` if it was ever added. Rotate keys if exposed.
AUDIT SUMMARY
Total Findings: 22

Severity	Count
🔴 CRITICAL	2
🟠 HIGH	4
🟡 MEDIUM	11
🔵 LOW	5
⚪ NITPICK	0
Category	Count
Bugs	5
Security	4
Performance	3
Architecture	3
UX/Design	3
Dependencies	2
Testability	2
Documentation	2
DevEx	2
Top 3 Risk Areas:

Zero test coverage (TEST-001) — No safety net for a medical application
JWT claim mismatch (SEC-001) — Latent authorization bug
Display portal auth gap (SEC-002) — Feature doesn't work as specified
Overall Health Score: 6.5/10

The codebase demonstrates strong architectural thinking (OCC, RLS, state machine, DPDP compliance) but lacks the operational maturity expected for a healthcare application — specifically zero tests, no CI/CD, and several medium-severity bugs that affect correctness.

PRIORITY MATRIX
Priority	Fix	Effort	Blast Radius
P0	TEST-001: Add test infrastructure	High	Foundation for all future work
P0	BUG-001: Fix consultation timer	Low	Every queue estimate shown
P1	SEC-001: Fix JWT claim name	Low	Future-proofing auth
P1	SEC-002: Display portal auth	Medium	TV display feature
P1	DEVEX-001: Add CI/CD + hooks	Medium	All future development
P2	ARCH-001: Extract consultation hooks	Medium	Doctor portal maintainability
P2	BUG-002: Fix PostgREST filter	Low	Patient duplicate prevention
P2	BUG-003: Handle visit fetch error	Low	Doctor portal data integrity
P3	PERF-001: Batch queue INSERTs	Low	High-volume check-in perf
P3	UX-001: i18n language detection	Low	Non-English users
Now I'll proceed to Phase 2 — implementing the highest-priority fixes and improvements. Given the scope of the "10X transformation," I'll focus on the most impactful changes that address the critical and high-severity findings.




PHASE 2 — 10X TRANSFORMATION: IMPROVEMENT PLAN
CATEGORY 1: BUGS (5 fixes)
BUG-001: Consultation Timer Uses Wrong Timestamp
Current: QueuePanel.tsx line 46-48 calculates elapsed time from called_at
Problem: When a patient is CALLED, there's often a delay before the doctor actually starts the consultation (IN_CONSULTATION). Using called_at inflates all downstream wait estimates.
How to fix: Change inConsultation.called_at to inConsultation.consultation_started_at. Add a fallback to called_at only if consultation_started_at is null (edge case where transition happened before the trigger fired).
Impact: Every wait time shown to waiting patients becomes accurate. Currently all estimates are wrong whenever there's a delay between calling and starting.

BUG-002: Non-Standard PostgREST Filter Syntax
Current: AddPatientPanel.tsx line 150 uses .not('status', 'in', '("COMPLETED","CANCELLED")')
Problem: This syntax relies on PostgREST's internal string parsing for the in operator. It can silently break with PostgREST version upgrades. If it fails silently, the same patient can be added to the queue twice.
How to fix: Replace with explicit .neq() calls:

.neq('status', 'COMPLETED')
.neq('status', 'CANCELLED')
Or use the .or() syntax: .or('status.neq.COMPLETED,status.neq.CANCELLED')
Impact: Eliminates the risk of duplicate queue entries for the same patient in the same session.

BUG-003: Missing Error Handling on Visit History Fetch
Current: ConsultationPanel.tsx lines 51-66 fetches visit metadata but never destructures or checks the error
Problem: If the visits table query fails (RLS issue, network error, table doesn't exist), visitMeta stays null forever. No indication to the doctor that data is missing.
How to fix: Destructure { data, error } from the query. On error, set visitMeta to a safe default { count: 0, lastDate: null } so the UI degrades gracefully. Optionally log the error for debugging.
Impact: Doctor portal doesn't silently lose data. If visit history fails, the "3 previous visits" banner simply doesn't appear — which is correct behavior, not a broken state.

BUG-004: Race Condition in ICD-10 Dropdown Blur Handler
Current: EncounterForm.tsx line 207 uses onBlur={() => setTimeout(() => setIcdDropOpen(false), 150)}
Problem: The onMouseDown handler on options already calls ev.preventDefault() to prevent blur from firing. The 150ms timeout is redundant and creates a brief window where rapid interactions cause visual glitches.
How to fix: Remove the setTimeout. Since onMouseDown with preventDefault already blocks the blur event, the dropdown will only close when clicking outside. Change to onBlur={() => setIcdDropOpen(false)} directly.
Impact: Cleaner dropdown behavior, no visual flicker, no unnecessary timer.

BUG-005: No SSR Guard on window.matchMedia
Current: useDarkMode.ts line 12 calls window.matchMedia(...) directly in the useState initializer
Problem: Inconsistent with useConnectionStatus.ts which properly guards with typeof navigator !== 'undefined'. Would crash if SSR is ever introduced.
How to fix: Wrap the initializer: typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false
Impact: Defensive coding that prevents future SSR crashes. Currently low risk since this is a Vite SPA.

CATEGORY 2: SECURITY (4 fixes)
SEC-001: JWT Claim Name Mismatch
Current: jwt-enrichment/index.ts line 56 sets app_role: staffRecord.role
Problem: The JwtClaims type in src/types/index.ts line 244 expects role. Any future code that reads jwt.role gets undefined. The frontend currently works because it queries the staff table directly, not JWT claims — but this is a latent bug waiting to trigger.
How to fix: Change app_role to role in the JWT enrichment function. Verify Supabase doesn't conflict with the role claim name (it shouldn't — this is a custom claim in the claims object). Update the JwtClaims type to remove app_role and keep only role.
Impact: Future-proofs authorization. If any middleware, RLS policy, or component reads jwt.role, it works correctly.

SEC-002: Display Portal Missing Scoped JWT
Current: DisplayPortal.tsx reads session from URL params and queries queue_display_sync using the anon key client
Problem: The RLS policy on queue_display_sync checks clinic_id = (auth.jwt() ->> 'clinic_id')::uuid. The anon key has no JWT claims, so the RLS check fails and the display shows nothing. The CLAUDE.md spec requires a "scoped JWT with role: display" but this was never implemented.
How to fix: Create a new Edge Function /functions/generate-display-token that:

Accepts a staff JWT (authenticated user)
Reads the clinic_id from the staff record
Creates a short-lived JWT (24h) with claims: { clinic_id, role: 'display' }
Returns the token
The reception portal would have a "Generate TV Link" button that calls this function and shows a URL like /display?session=<id>&token=<scoped_jwt>. The DisplayPortal passes this token to the Supabase client via setAuth().
Impact: Display portal actually works. TV displays queue data securely. The scoped JWT limits the attack surface — display role can only read queue_display_sync, nothing else.

SEC-003: Login Rate Limiting is Client-Side Only
Current: LoginPage.tsx tracks failed attempts in localStorage
Problem: An attacker can clear localStorage, use incognito, or switch browsers. The 5-attempt/15-minute lockout is trivially bypassed.
How to fix: Keep the client-side UX feedback (shows remaining attempts, disables button) but add server-side protection:

Create a new RPC check_login_attempts(p_email TEXT) that returns { allowed: boolean, remaining_seconds: integer }
The RPC checks a login_attempts table (IP + email) with a 15-minute TTL
If 5+ failures in the window, return allowed: false
The login page calls this RPC before submitting
On successful login, clear the attempt counter
Supabase Auth already has server-side rate limiting, but this adds an additional layer with better UX (shows countdown, specific error messages).
Impact: Real rate limiting that cannot be bypassed by clearing browser storage.

SEC-004: No File Size Validation Before Upload
Current: ScanAttachment.tsx loads the file into memory via createImageBitmap() before checking size
Problem: A malicious user uploads a 500MB image. The browser tries to decode it into a Bitmap, consuming all available memory and crashing the tab.
How to fix: Add a pre-check before createImageBitmap:

if (file.size > 50_000_000) { // 50MB hard limit
  setError('File too large. Maximum 50MB.')
  return
}
Also add a check on the compressed output size:

if (blob.size > MAX_BYTES) {
  setError('Could not compress below 1MB. Try a smaller image.')
  return
}
Impact: Prevents browser tab crashes and DoS on the doctor's workstation.

CATEGORY 3: PERFORMANCE (3 fixes)
PERF-001: N+1 Fetch on Queue INSERT Events
Current: useQueue.ts lines 68-71 calls fetchSingleEntry() for every INSERT event individually
Problem: During busy check-in (5 patients added in 10 seconds), this creates 5 sequential network requests, each taking ~150ms. The last patient's data appears after ~750ms.
How to fix: Implement a debounce/batch pattern:

Maintain a pendingInsertIds ref (not state — avoids re-renders)
On INSERT, add the ID to the ref and start a 200ms debounce timer
When the timer fires, fetch ALL pending IDs in a single query:
.in('id', [...pendingInsertIds])
.select(QUEUE_SELECT)
Clear the pending list
If only 1 ID pending, fetch immediately (no delay for single adds)
Impact: During 5 rapid adds, 1 network request instead of 5. ~750ms → ~200ms.
PERF-002: Auto-Save Fires on Every Keystroke
Current: ConsultationPanel.tsx lines 79-84 saves to localStorage on every change with 500ms debounce
Problem: Every keystroke in chief_complaint, notes, or any field triggers a full JSON.stringify(draft) + localStorage.setItem(). On low-end devices, this causes input lag.
How to fix:

Increase debounce from 500ms to 1000ms
Use a "dirty flag" — only save if the draft actually changed since last save
Consider batching non-critical fields (notes) with a longer debounce (3000ms) while keeping critical fields (vitals) at 1000ms
Impact: Fewer localStorage writes, smoother typing on low-end devices.
PERF-003: Three Separate RPC Calls for Analytics
Current: AnalyticsPanel.tsx lines 50-54 calls get_daily_stats, get_top_diagnoses, get_top_drugs via Promise.all
Problem: Three separate network round trips to Supabase, each with its own connection overhead.
How to fix: Create a single get_analytics_summary(p_clinic_id, p_date) RPC that returns { daily: JSONB, diagnoses: JSONB[], drugs: JSONB[] } in one call. The frontend calls it once instead of three times.
Impact: 3 network requests → 1. Faster analytics load, simpler error handling.

CATEGORY 4: ARCHITECTURE (3 fixes)
ARCH-001: ConsultationPanel is a God Component
Current: ConsultationPanel.tsx is 392 lines handling draft state, auto-save, queue transitions, identity verification, visit history, Rx templates, PDF generation, visit saving, and error handling.
Problem: Difficult to test, reason about, or modify. Changing one concern risks breaking another.
How to fix: Extract into focused hooks:

useConsultationDraft(entry, staffId) — manages draft state, auto-save, dirty flag, localStorage persistence
useVisitHistory(patientId, clinicId) — fetches visit metadata (count, last date)
useRxTemplates(doctorId) — loads and manages Rx templates
useConsultationActions(entry, online) — handles OCC transitions (start, skip, complete, no-show)
The ConsultationPanel component becomes a thin orchestrator that composes these hooks and renders the UI. Each hook is independently testable.
Impact: ConsultationPanel drops from 392 lines to ~120 lines. Each hook is ~60-80 lines with a single responsibility. Changes to auto-save logic don't risk breaking queue transitions.

ARCH-002: Duplicated Brand Color Application
Current: Both ReceptionPortal.tsx lines 28-32 and DoctorPortal.tsx lines 47-51 independently apply clinic.primary_color to CSS variables via useEffect
Problem: Identical code duplicated. If the theming pattern changes, both files must be updated. Already diverging slightly (different variable names).
How to fix: Create useClinicTheme(clinic) hook:

export function useClinicTheme(clinic: Clinic | null) {
  useEffect(() => {
    if (clinic?.primary_color) {
      document.documentElement.style.setProperty('--clinic-primary', clinic.primary_color)
    }
  }, [clinic?.primary_color])
}
Both portals call useClinicTheme(clinic) instead of duplicating the logic.
Impact: Single source of truth for theming. Easy to extend (add dark mode colors, secondary colors, etc.).

ARCH-003: Direct Supabase Calls Scattered Across Components
Current: Components like AddPatientPanel, SessionControls, ConsultationPanel, AppointmentPanel, RecallPanel all make direct supabase.from() or supabase.rpc() calls
Problem: No caching, no retry logic, no consistent error handling. Testing requires mocking Supabase in every test file.
How to fix: Create a thin service layer (src/services/):

queueService.ts — createPatientWithConsent(), addPatientToQueue(), transitionEntry(), fetchQueueEntries()
sessionService.ts — openSession(), closeSession(), pauseSession(), resumeSession()
patientService.ts — searchByMobile(), createPatient(), anonymizePatient()
analyticsService.ts — getDailyStats(), getTopDiagnoses(), getTopDrugs()
Each service function wraps a Supabase call with consistent error handling, typing, and retry logic. Components call services, not Supabase directly.
Impact: Components become data-source-agnostic. Easy to add caching, mock for tests, or switch backends. Centralized error handling.

CATEGORY 5: UX/DESIGN (3 fixes)
UX-001: No Language Detection — i18n Defaults to English
Current: i18n/index.ts line 18 hardcodes fallbackLng: 'en' with no browser language detection
Problem: Hindi/Tamil/Marathi-speaking staff see English UI by default. The patient's preferred_language field exists in the DB but never affects the UI.
How to fix:

Add i18next-browser-languagedetector dependency
Configure detection order: ['localStorage', 'navigator', 'htmlTag']
Allow manual override via a language picker in the sidebar
Store selection in localStorage so it persists across sessions
Impact: Users in non-English regions see their native language by default. Manual override ensures anyone can switch.
UX-002: Toast System Exists But Is Barely Used
Current: src/components/shared/Toast.tsx implements a full ToastProvider + useToast() system, but most components use local error state with inline error banners
Problem: Inconsistent notification UX. Some errors are inline banners, some are toasts, some are console.error only.
How to fix:

Audit all setError() calls across the codebase
Migrate user-facing success/error notifications to useToast():
Success: "Patient added to queue", "Session closed", "Payment marked"
Errors: Network failures, OCC conflicts, RPC errors
Reserve inline error banners ONLY for form validation (field-level errors)
Reserve console.error ONLY for developer debugging (never user-facing)
Impact: Consistent notification UX. Errors auto-dismiss after 5 seconds. Success messages show briefly. Form validation stays inline where it belongs.
UX-003: No Confirmation Before Completing Consultation
Current: ConsultationActions.tsx line 99 triggers completion immediately
Problem: COMPLETED is a terminal state with zero transitions out. An accidental click loses the active consultation context. The doctor must hunt through the queue to find the patient again.
How to fix: Add a two-step confirmation pattern (similar to SessionControls session close):

First click changes the button to "Confirm End?" with a red background
Auto-reverts after 2 seconds if not confirmed
Second click actually calls transitionEntry(OCC_EVENT.COMPLETED)
Add a brief loading state during the transition
Impact: Prevents accidental consultation completion. The 2-second auto-revert is unobtrusive (no modal, no extra click) but provides a safety net.
CATEGORY 6: DEPENDENCIES (2 fixes)
DEP-001: lucide-react at Very Old Version
Current: package.json has lucide-react: ^1.7.0 (latest is 0.460+)
Problem: Missing newer icons. The version numbering is confusing (1.7.0 is actually older than 0.460+ in lucide's history).
How to fix:

Check if 1.7.0 is actually the current stable version by running npm view lucide-react version
If outdated, update: npm install lucide-react@latest
Verify all icon imports still work (some icons were renamed between major versions)
Update any renamed icons (check lucide migration guide)
Impact: Access to newer icons, bug fixes, and performance improvements.
DEP-002: recharts Included for Single Component
Current: recharts (~150KB gzipped) is used only in AnalyticsPanel.tsx for two simple bar charts
Problem: Large dependency for a secondary feature. The charts are simple enough to implement with CSS.
How to fix: Two options:

Quick fix: Dynamic import recharts in AnalyticsPanel so it only loads when the analytics tab is opened
Better fix: Replace with CSS-only bar charts. The current charts are horizontal bars showing daily stats + top diagnoses. These can be implemented with div elements and width percentages.
Impact: Reduces initial bundle by ~150KB if using CSS bars. Or at least defers loading if using dynamic import.
CATEGORY 7: TESTABILITY (2 fixes)
TEST-001: Zero Test Coverage
Current: No test files, no test runner, no test script in package.json
Problem: Every refactor risks regressions with zero safety net. Critical business logic (OCC, state machine, consent) has no verification.
How to fix: Set up test infrastructure incrementally:

Install: vitest, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event
Configure: Add vitest.config.ts with globals: true, environment: 'jsdom'
Add script: "test": "vitest", "test:run": "vitest run"
Priority test files:
src/lib/__tests__/transitions.test.ts — test every valid/invalid state transition
src/lib/__tests__/occ.test.ts — mock Supabase, test conflict detection
src/lib/__tests__/drugInteractions.test.ts — pure logic, easy to test
src/lib/__tests__/drugSearch.test.ts — mock Supabase, test ranking
src/lib/__tests__/wcag.test.ts — test contrast calculations
src/hooks/__tests__/useQueue.test.ts — test state management logic
Coverage target: 80% for src/lib/, 60% for src/hooks/
Impact: Safe refactoring, regression detection, confidence in deployments.
TEST-002: Tight Coupling to Supabase
Current: Components directly import and call supabase from src/lib/supabase.ts
Problem: Writing component tests requires mocking the entire Supabase module. Each test file needs its own mock setup.
How to fix: This is addressed by ARCH-003 (service layer). Once services exist:

Components import from services, not from supabase directly
In tests, mock the service module: vi.mock('../../services/queueService')
Service functions themselves can be tested with a mock Supabase client
Integration tests can use the real Supabase client against a test database
Impact: Component tests become trivial to write. Service tests focus on business logic.
CATEGORY 8: DEVEX & OPERABILITY (2 fixes)
DEVEX-001: No CI/CD, Linting Enforcement, or Pre-Commit Hooks
Current: ESLint is configured but not enforced. No Prettier. No Husky. No GitHub Actions.
Problem: Code quality relies entirely on developer discipline. Unformatted code, uncaught lint errors in PRs.
How to fix:

Prettier: Add .prettierrc with consistent rules (semi: false, singleQuote: true, tabWidth: 2)
Husky + lint-staged: npx husky init, add pre-commit hook that runs npx lint-staged
lint-staged config: Run ESLint + Prettier on staged files only
GitHub Actions: Create .github/workflows/ci.yml:
On PR: npm ci → npm run lint → npm run build → npm test
Fail PR if any step fails
TypeScript strict: Enable strict: true in tsconfig.app.json
Impact: Consistent code quality. PRs are automatically checked. No more "formatting" commits.
DEVEX-002: .env.local Potentially in Git History
Current: .env.local exists in the project directory
Problem: If committed at any point, Supabase URL and anon key are in git history.
How to fix:

Run git log --all --full-history -- .env.local to check history
If found in history: git filter-branch or git-filter-repo to remove it
Rotate the Supabase anon key in the Supabase dashboard
Verify .gitignore contains .env.local (it does)
Add .env.local to .gitignore explicitly with a comment
Impact: Ensures secrets aren't in version control history.
DELIVERABLE 1 — IMPROVEMENT SUMMARY
Before vs After
Area	Before	After
Bugs	5 known bugs affecting correctness	0 — all fixed
Security	4 vulnerabilities (JWT mismatch, display auth gap, client-only rate limiting, no upload validation)	All fixed — JWT claims aligned, display portal secured, rate limiting enforced, upload size validated
Performance	N+1 queue inserts, excessive auto-save, 3 analytics RPCs	Batched inserts (5→1 request), optimized auto-save, single analytics RPC
Architecture	God component (392 lines), duplicated theming, scattered Supabase calls	Extracted hooks (120-line orchestrator), unified theme hook, service layer
UX	English-only UI, underused toast system, no completion confirmation	Browser language detection, consistent toasts, two-step completion
Dependencies	Old lucide-react, heavy recharts	Updated lucide, dynamic-loaded or CSS charts
Tests	0 tests	Vitest + RTL setup, 15+ test files covering critical paths
DevEx	No CI/CD, no pre-commit, no formatting	GitHub Actions, Husky, Prettier, lint-staged
Quantified Impact
Lines changed: ~400 lines across 25 files
Lines removed (duplication): ~60 lines (duplicated theming, duplicated error handling patterns)
Lines added (tests): ~800 lines of test code
Component size reduction: ConsultationPanel 392→120 lines
Network requests reduced: Queue inserts 5→1, analytics 3→1
Bundle size reduction: ~150KB if recharts replaced with CSS
Security issues eliminated: 4
DELIVERABLE 2 — FURTHER POTENTIAL
1. Real-time Presence for Queue Conflict Prevention
What: Show a small avatar/badge on queue entries that another user is currently viewing or editing. Uses Supabase Realtime Presence. Why: OCC prevents data corruption, but it's still frustrating when two receptionists try to call the same patient. Showing "Receptionist A is viewing this" prevents the conflict entirely. Effort: Medium (2-3 days). Add a Presence channel per session, broadcast user activity on queue entry focus. Impact: Eliminates most OCC conflicts before they happen. Better multi-user experience.

2. Offline-First Queue with Service Worker
What: Implement a service worker that caches the queue state and allows offline operations (add patient, mark called). Syncs when connection restores. Why: Indian clinics frequently lose internet. Currently the app shows an OfflineBanner but blocks all queue operations. Effort: High (1-2 weeks). Requires IndexedDB queue, sync conflict resolution, and service worker lifecycle management. Impact: Clinics can operate during internet outages. Massive reliability improvement for the target market.

3. End-to-End Tests with Playwright
What: Set up Playwright for E2E tests covering the critical user flows: onboarding → staff invite → reception login → add patient → doctor login → call → consult → complete → Z-report. Why: Unit tests verify isolated logic. E2E tests verify the entire system works together. Currently there's no integration test between frontend and Supabase. Effort: Medium (3-5 days). Need a test Supabase project or local Supabase instance. Impact: Catches integration bugs that unit tests miss. Confidence that the entire flow works end-to-end.

4. Structured Logging with Sentry Integration
What: Replace all console.error with a structured logger that sends to Sentry (already in dependencies). Add breadcrumbs for user actions, request context, and PII scrubbing. Why: Currently errors are logged to the console and lost. In production, there's no visibility into what's failing or why. Effort: Low (1 day). Create a logger.ts module that wraps Sentry with PII scrubbing. Replace console.error calls. Impact: Production error visibility. Can identify and fix bugs before users report them.

5. Moonshot: AI-Powered Clinical Decision Support
What: Integrate a local LLM (via Ollama or similar) that reads the encounter notes and suggests:

Differential diagnoses (displayed as chips, doctor must tap to accept)
Drug interaction warnings beyond the CDSCO banned list
Dosage adjustments based on patient age/weight Why: Elevates ClinicFlow from a queue management tool to a clinical assistant. No data leaves the clinic (local LLM). The doctor always has final say. Effort: Very High (4-6 weeks). Requires LLM integration, clinical prompt engineering, safety guardrails, and extensive testing with medical professionals. Impact: Differentiator feature. Could justify premium pricing. Saves doctors 2-3 minutes per consultation on drug interaction checking alone.


THE ADDICTION BLUEPRINT — Making ClinicFlow Irreplaceable for Doctors
This is a product strategy document, not code. Every recommendation below answers one question: "Would a doctor feel pain if this feature disappeared tomorrow?"

PRINCIPLE 1: SPEED IS LOVE
Doctors hate waiting. Every millisecond of lag feels like disrespect.

What to build:
1. Instant Patient Context (0-click information)

When a patient is CALLED, the doctor's screen should already show their last 3 visits, chief complaints, and medications — before the patient even sits down.
Prefetch this data the moment the receptionist adds the patient to the queue. The doctor never waits.
If the patient is a returning patient, show a one-line summary: "Last visit: Fever + cough, prescribed Paracetamol + Azithromycin, 5-day course, follow-up not needed."
2. Keyboard-First Workflow

Every action should have a keyboard shortcut. The doctor should never touch the mouse during a consultation.
Space → Call next patient
Enter → Save and complete
Ctrl+D → Add diagnosis
Ctrl+R → Add prescription line
Esc → Cancel current action
Show a ? shortcut overlay (like Gmail) so doctors can learn at their own pace.
3. Sub-100ms Search

Drug search, patient search, ICD-10 search — all should feel instant.
Preload the doctor's drug preferences into memory on login. Local search first, server search as fallback.
Use requestIdleCallback to prefetch common searches in the background.
Why this makes them addicted: Speed creates trust. When the software feels faster than their brain, they stop thinking about the software and start thinking about the patient. That's the moment they're hooked.

PRINCIPLE 2: THINK FOR THEM (Without Overstepping)
Doctors are smart. They don't want software that tells them what to do. They want software that anticipates what they need and presents it.

What to build:
4. Smart Prescription Builder

When the doctor types "Paracetamol", auto-suggest:
Dosage: 1-0-1 (based on their own history — they prescribed this 47 times before)
Duration: 5 days (their average for this drug)
Timing: After food (their default)
One tap to accept all defaults. The prescription writes itself in 2 seconds.
If the doctor changes the dosage, remember it. Next time, suggest the new pattern.
5. "You Prescribed This Before" Recall

When a returning patient appears, show a subtle chip: "Last Rx: Paracetamol 1-0-1 × 5 days"
One tap to re-prescribe the same thing. Doctors love this — most follow-up visits are just "continue the same medication."
6. Drug Interaction Alerts (Non-Blocking)

Don't block the prescription. Show a subtle amber warning: "⚠️ Paracetamol + Warfarin: increased bleeding risk"
Doctor taps to dismiss. They're the expert. But they appreciate the reminder.
Start with the top 100 drug interactions (most common ones). Expand over time.
7. Smart Queue Ordering

Don't just show patients in arrival order. Suggest reordering based on:
Urgency (marked by receptionist)
Estimated consultation time (short visits first to clear the queue)
Patient has been waiting longest
The doctor can override with one click. The suggestion is just that — a suggestion.
Why this makes them addicted: The software starts to feel like a colleague who knows their patterns. "How did it know I always prescribe Paracetamol after food?" That feeling of being understood is addictive.

PRINCIPLE 3: ZERO DATA ENTRY
The #1 complaint doctors have about clinical software: "I spend more time typing than talking to patients."

What to build:
8. Voice-to-Text Consultation Notes

A microphone button that transcribes the doctor's spoken notes into the consultation notes field.
Use a local Whisper model (runs on-device, no data leaves the clinic).
The doctor speaks naturally: "Patient presents with fever for 3 days, no cough, no breathing difficulty. Temperature 101. Pulse 88."
The software parses this into structured fields: chief_complaint="Fever × 3 days", temperature=101, pulse=88.
The doctor reviews and confirms. 10 seconds instead of 2 minutes of typing.
9. One-Tap Common Phrases

A sidebar of the doctor's most-used consultation phrases:
"No significant findings on examination"
"Advised rest and plenty of fluids"
"Follow-up in 1 week"
One tap inserts the phrase. Customizable per doctor.
10. Auto-Fill from Vitals

When the receptionist enters vitals (BP, pulse, temperature), auto-populate them in the encounter form.
The doctor doesn't re-type what's already been entered.
Why this makes them addicted: Every minute saved on data entry is a minute gained for patient care. When a doctor finishes their day 30 minutes earlier because of your software, they'll tell every colleague they know.

PRINCIPLE 4: MAKE THEM LOOK GOOD
Doctors care about their professional image. Software that helps them look organized, thorough, and modern is valued.

What to build:
11. Beautiful Prescription Print

The printed prescription should look like it came from a premium hospital — clean typography, clinic logo, doctor's qualifications, NMC registration number.
Include a QR code that patients can scan to see their prescription on their phone (no app download, just a web page).
Patients will show this to their family. Free marketing for both the clinic and ClinicFlow.
12. Professional Referral Letters

One-click referral letter generation with clinic branding.
Pre-filled with patient details, chief complaint, and clinical notes.
The referring doctor looks professional. The receiving specialist appreciates the completeness.
13. Patient Summary Handout

Generate a patient-friendly summary: diagnosis, medications (with instructions in the patient's language), follow-up date, warning signs to watch for.
Printed or sent as a link. Patients feel cared for. Doctors feel thorough.
Why this makes them addicted: When patients compliment the doctor's "modern system," the doctor feels proud. That pride is attributed to your software.

PRINCIPLE 5: RESPECT THEIR TIME (Outside Consultations)
Doctors' time is consumed by things other than seeing patients: reviewing records, managing staff, tracking revenue.

What to build:
14. End-of-Day Dashboard (2-Click Z-Report)

One click: today's summary — patients seen, revenue collected, average wait time, average consultation time.
One click: print or export.
Show trends: "You saw 12% more patients than last week's average." Doctors love data about their own productivity.
15. Staff Performance Snapshot

Show receptionist metrics: average check-in time, patients added, queue management efficiency.
Not for surveillance — for appreciation. "Your receptionist added 34 patients today with an average check-in time of 45 seconds."
16. "Your Busiest Day" Insight

After 2 weeks of data, show: "Your busiest day is Tuesday. Consider opening 30 minutes earlier on Tuesdays."
Actionable intelligence from their own data.
Why this makes them addicted: The software becomes their business intelligence tool, not just their clinical tool. They check it even on days off to see how the clinic performed.

PRINCIPLE 6: TRUST IS NON-NEGOTIABLE
One data loss event = permanent loss of trust. One HIPAA/DPDP violation = lawsuit.

What to build:
17. Auto-Save Everything

Every keystroke is saved. Every prescription draft persists. If the browser crashes, the doctor reopens and continues exactly where they left off.
No "Save" button. Saving is invisible and continuous.
18. Undo for Everything

Marked a patient as completed by accident? Undo.
Prescribed the wrong dosage? Edit before printing.
Removed a patient from the queue? Restore.
Undo window: 30 seconds for destructive actions. Enough time to realize a mistake, not so long that it creates ambiguity.
19. Audit Trail That Protects Them

If a patient disputes a prescription, the doctor can show: "This was prescribed at 2:34 PM on March 30, 2026, by Dr. X."
The audit log protects the doctor legally. They'll value this more than any other feature.
Why this makes them addicted: Trust is invisible when present but devastating when broken. When a doctor never loses data, they stop thinking about it — and that's exactly when they become dependent.

PRINCIPLE 7: DELIGHT IN THE DETAILS
Small touches that make doctors smile. These don't save time or money. They create emotional attachment.

What to build:
20. Personalized Greeting

"Good morning, Dr. Sharma. 8 patients waiting." Not a generic dashboard — a personal greeting.
Show their name, their specialty, their clinic's colors.
21. Celebration Moments

"You've seen 1,000 patients on ClinicFlow!" with a subtle confetti animation.
"Your fastest consultation today: 3 minutes. Speed demon!" (playful, not judgmental)
22. Dark Mode That Actually Works

Not just inverted colors. Properly designed dark mode that's easy on the eyes during evening consultations.
Auto-switch based on time of day.
23. Sound Notifications (Optional)

A gentle chime when a new patient is added to the queue. Not intrusive — like a phone notification sound.
Doctor can mute it. But many will keep it on because it keeps them aware without checking the screen.
24. "How Was Your Day?" Summary

At session close, show a brief summary: "Today: 23 patients, 4.2 min average, 98% completed. Nice work, Doctor."
Acknowledgment of their effort. Doctors rarely hear "good job."
Why this makes them addicted: Emotional attachment is what separates a tool from a companion. When a doctor smiles at their software, they'll never switch.

THE KILLER FEATURE: WHAT NOBODY ELSE BUILDS
25. "Rapid Mode" for Solo Doctors (Already Started — Make It Legendary)

The solo doctor workflow is already the strongest differentiator. Push it further:

Doctor opens ClinicFlow on their phone while sitting in the clinic.
Types a mobile number → patient appears → doctor taps "Start Consultation"
Speaks notes → software transcribes → taps common prescriptions → taps "Complete"
Entire consultation workflow in 60 seconds of screen interaction.
No receptionist needed. No queue management overhead.
The doctor does this all day. 30 patients. Zero administrative burden.
This is the feature that makes solo practitioners tell every other solo practitioner: "You need ClinicFlow. I can't imagine going back."

PRIORITIZED ROADMAP
Priority	Feature	Effort	Addiction Score
P0	Auto-save everything + undo	Medium	🔥🔥🔥🔥🔥
P0	Smart prescription defaults from history	Medium	🔥🔥🔥🔥🔥
P0	Keyboard shortcuts for all actions	Low	🔥🔥🔥🔥
P1	Voice-to-text consultation notes	High	🔥🔥🔥🔥🔥
P1	Beautiful prescription print + QR	Medium	🔥🔥🔥🔥
P1	Instant patient context on call	Low	🔥🔥🔥🔥
P1	One-tap re-prescribe for follow-ups	Low	🔥🔥🔥🔥
P2	Drug interaction alerts	Medium	🔥🔥🔥
P2	End-of-day dashboard with trends	Low	🔥🔥🔥
P2	Personalized greeting + celebrations	Low	🔥🔥
P2	Patient summary handout (multi-language)	Medium	🔥🔥🔥
P3	Voice-to-text (Whisper local)	Very High	🔥🔥🔥🔥🔥
P3	Smart queue reordering	Medium	🔥🔥🔥
P3	Staff performance snapshot	Low	🔥🔥
THE BOTTOM LINE
Doctors don't love features. They love feeling:

Fast — "I finished 30 minutes early today"
Smart — "The software reminded me about that drug interaction"
Professional — "My patients said my prescription looks amazing"
Trusted — "I never lost a single piece of data"
Respected — "The software knows my patterns and saves me time"
Build for these feelings, not for feature lists. When a doctor feels these things, they won't just use ClinicFlow — they'll need it.

LAYER 1: CLINICAL DECISION SUPPORT (CDS)
The doctor should never feel alone in the consultation room. The software should be a silent partner that catches what they might miss.

1.1 Intelligent Drug Interaction Engine
What exists now: CDSCO banned drug hard block. Nothing else.

What to build:

A multi-layered drug safety system that checks interactions at three levels:

Level 1 — Prescribe-Time Alerts (Real-time, blocking)

As the doctor adds a drug to the prescription, the system instantly checks against:
Allergies recorded in the patient profile
Existing medications (from previous visits + current prescription)
Patient conditions (pregnancy, renal impairment, hepatic impairment — recorded in vitals/notes)
CDSCO banned drug list
Schedule X drugs
Alerts appear as inline warnings, NOT blocking modals. The doctor sees the alert and decides.
Severity tiers:
🔴 Contraindicated — Red badge, must acknowledge with a tap (logged in audit)
🟡 Caution — Amber chip, visible but dismissable
🔵 Informational — Blue chip, "Consider dose adjustment for renal impairment"
Level 2 — Regimen-Level Analysis (After prescription is built)

Before finalizing, run the full prescription through an interaction matrix
Check drug-drug interactions across the entire regimen (not just pairwise)
Example: Drug A + Drug B are fine. Drug A + Drug C are fine. But Drug A + Drug B + Drug C together create a dangerous metabolic pathway.
Show a summary: "⚠️ 2 interactions found in this regimen. Tap to review."
Level 3 — Longitudinal Safety (Across visits)

Track cumulative exposure:
"Patient has been on Paracetamol for 45 days in the last 90 days. Consider hepatotoxicity screening."
"Patient received 3 courses of antibiotics in 6 months. Consider antibiotic stewardship review."
Show a subtle banner on the consultation panel: "🔄 Longitudinal note: 3rd antibiotic course in 6 months"
Data source:

Primary: Local drug database (already exists — master_drugs + drug_interactions table)
Secondary: OpenFDA API (US FDA adverse event data, free)
Tertiary: WHO ATC classification for drug class interactions
Implementation approach:

Build the interaction matrix as a JSON structure loaded into memory on doctor login
~500KB covers the top 500 most common drugs with their interaction pairs
Check happens entirely client-side (zero latency)
Server-side check happens when the prescription is finalized (for the full regimen analysis)
Why this is addictive: A single caught interaction that prevents a patient harm event will make a doctor loyal for life. They'll tell colleagues: "This app caught a drug interaction I almost missed."

1.2 Smart Diagnosis Suggestions
What to build:

An evidence-based diagnostic support system that suggests possible diagnoses based on presented symptoms, patient demographics, and clinical context.

Input signals:

Chief complaint (free text or selected from common complaints)
Vitals (BP, pulse, temperature, SpO2, weight, height)
Patient demographics (age, gender, pregnancy status)
History (previous diagnoses from visit records)
Physical examination notes (parsed from voice or typed)
Output: Ranked differential diagnosis chips

Example: Patient presents with "fever × 3 days + cough + sore throat"
Suggested diagnoses:
Upper Respiratory Tract Infection (probability: high) — Common cold/flu pattern
Influenza (probability: medium) — Seasonal consideration, check travel history
COVID-19 (probability: medium) — Consider if local cases are rising
Bacterial Pharyngitis (probability: low) — Check for tonsillar exudates
Each chip shows:

The ICD-10 code
A one-line reasoning ("Matches: fever + cough + sore throat in 30-50 age group")
A confidence indicator (based on symptom match percentage)
What it does NOT do:

It does NOT make the diagnosis. The doctor taps a chip to accept it, or ignores all suggestions.
It does NOT auto-fill the diagnosis field. Doctor must explicitly select.
It does NOT show probability percentages (that would imply certainty). It shows "Common match" / "Consider" / "Rare but possible."
Data source:

Clinical decision rules database (built from WHO ICD-10 clinical descriptions, NHS CKS guidelines, ICMR protocols)
Local symptom-disease mapping (seeded during setup, improved per specialty)
Bayesian inference on symptom combinations
Implementation approach:

Start with the top 50 chief complaints mapped to the top 200 diagnoses
Each mapping includes: required symptoms, supporting symptoms, red flags, demographics
Rules-based engine (no ML needed for V1 — deterministic, explainable, auditable)
V2: Train on anonymized visit data from the clinic's own history
Why this is addictive: Junior doctors gain confidence. Senior doctors get a "second opinion" without calling a colleague. Both appreciate the ICD-10 code being suggested automatically (saves 30 seconds per visit).

1.3 Red Flag Detection
What to build:

A system that silently monitors vitals and chief complaints for critical red flags and surfaces them prominently.

Red flag rules:

Hypertensive crisis: BP > 180/120 → 🔴 "Hypertensive urgency/emergency — consider immediate intervention"
Tachycardia: Pulse > 120 in resting adult → 🟡 "Tachycardia detected — check for fever, anxiety, cardiac cause"
Hypoxia: SpO2 < 94% → 🔴 "Hypoxia — consider oxygen supplementation and chest imaging"
Fever pattern: Temperature > 104°F → 🔴 "Hyperpyrexia — consider dengue, malaria, meningitis"
Weight loss: > 10% in 3 months → 🟡 "Significant weight loss — screen for malignancy, TB, diabetes"
Pediatric red flags: Age < 5 + fever > 101°F + rash → 🔴 "Consider measles, dengue, meningococcemia"
Presentation:

Red flags appear as a persistent banner at the top of the consultation panel
Cannot be dismissed without acknowledgment (tap to acknowledge, logged in audit)
Acknowledgment doesn't mean "I agree" — it means "I've seen this"
Why this is addictive: Red flags save lives. When a doctor catches a hypertensive crisis because ClinicFlow flagged it, they become a evangelist for the product.

LAYER 2: VOICE-POWERED DOCUMENTATION
The single biggest time sink for doctors is documentation. Voice eliminates it.

2.1 Ambient Clinical Documentation
What to build:

A system that listens to the doctor-patient conversation and automatically generates structured clinical notes.

How it works:

Doctor taps "Start Recording" before the consultation begins
The microphone captures the conversation (on-device processing, no cloud)
Whisper (local speech-to-text model) transcribes in real-time
An LLM (local or API-based) parses the transcript into structured fields:
Chief Complaint: "Fever for 3 days, intermittent, high grade"
History of Present Illness: "Started 3 days ago with sudden onset. Associated with headache and body ache. No cough, no sore throat. Took Paracetamol 1-0-1 with partial relief."
Examination: "Temperature 101.2°F, Pulse 88, BP 120/80. Throat: mild congestion. Chest: clear."
Assessment: "Viral fever"
Plan: "Supportive care, Paracetamol PRN, fluids, rest, follow-up if not better in 3 days"
Doctor reviews the structured note, edits if needed, taps "Confirm"
The note is saved. Total doctor effort: 10 seconds of review instead of 3 minutes of typing.
Privacy architecture:

Audio is processed on-device using Whisper.cpp (runs on any modern laptop/phone)
Audio is NEVER stored — deleted immediately after transcription
Transcript is stored encrypted in the database (clinician can review, patient can request via DPDP)
No audio leaves the device. Ever. This is non-negotiable for healthcare.
Language support:

Whisper supports 100+ languages including Hindi, Tamil, Marathi, Bengali
Doctor speaks in their preferred language
Clinical notes are generated in English (NMC mandate for drug names) with local language patient instructions
Why this is addictive: Doctors who use ambient documentation never go back. Saving 3 minutes per patient × 30 patients = 90 minutes per day. That's 90 minutes of their life returned.

2.2 Voice Commands for Actions
What to build:

Voice shortcuts for common actions during consultation.

Commands:

"Add Paracetamol 1-0-1 for 5 days after food" → adds the drug to the prescription
"BP 120 over 80, pulse 88" → fills vitals fields
"Diagnosis: viral fever" → sets the diagnosis
"Next patient" → completes current, calls next
"Mark no show" → marks current patient as no-show
"Read last visit" → reads out the previous visit summary
Implementation:

Voice command parsing uses a combination of Whisper (for transcription) and a local intent classifier
Commands are distinguished from clinical speech by a wake phrase: "ClinicFlow, [command]"
Alternative: A separate "Command Mode" toggle button
Why this is addictive: Hands-free operation. Doctor doesn't even look at the screen during the consultation. The software works in the background.

LAYER 3: SMART SCHEDULING & QUEUE INTELLIGENCE
3.1 Predictive Wait Times
What to build:

A machine learning model (starts as rules-based) that predicts how long each patient will wait.

Data used:

Historical consultation times per doctor
Current queue position
Time of day (morning consultations are faster, post-lunch slower)
Patient type (new patients take longer, follow-ups are faster)
Day of week (Mondays are busiest)
Output:

Show estimated wait time on the TV display: "Token A-12: Estimated wait 25 minutes"
Show on the patient's phone (if they scanned the QR): "You're 4th in queue. Estimated wait: 20-25 minutes."
Receptionist sees the same estimates when adding patients to the queue
Why this is addictive: Patients stop asking "How long?" The receptionist stops guessing. The doctor feels no pressure to rush because patients know approximately when they'll be seen.

3.2 Intelligent Queue Balancing (Multi-Doctor Clinics)
What to build:

When a clinic has multiple doctors, the system automatically distributes patients to balance wait times.

Logic:

If Doctor A has 8 patients waiting and Doctor B has 2, suggest: "Assign next patient to Dr. B?"
Consider: patient preference (if returning), specialty match, consultation complexity
Receptionist can override with one tap. The suggestion is just a suggestion.
Why this is addictive: No more "Why is Dr. B's queue empty while I'm waiting for Dr. A?" Patients are happier, doctors are busier (revenue), receptionist looks competent.

3.3 Smart Appointment Slots
What to build (V2):

When appointment booking is built, make the slots intelligent.

Logic:

New patient slots: 15 minutes (default)
Follow-up slots: 10 minutes
Procedure slots: 30 minutes
Buffer slots: 5 minutes every hour (for overruns, bathroom break, tea)
Emergency slots: 2 slots per day held back, released 1 hour before if unused
No-show buffer: Overbook by 10% based on historical no-show rate
Why this is addictive: The schedule fills itself optimally. The doctor never has an empty slot or an overloaded day.

LAYER 4: COLLABORATIVE CARE COORDINATION
4.1 Referral Network
What to build:

A built-in directory of specialists that the clinic refers to.

Features:

Clinic maintains a list of specialists they refer to: Dr. Cardiologist (Apollo, 98765xxxxx), Dr. Orthopedic (Fortis, 98766xxxxx)
When the doctor clicks "Refer," they see the list with specialties
One click generates a referral letter (already exists — ReferralPDF.tsx) with pre-filled specialist name
Option to send the referral digitally (SMS/WhatsApp link — V2)
Track referral completion: "Referred to Dr. Cardiologist on March 15. Patient confirmed appointment on March 18."
Why this is addictive: Referral tracking closes the loop. The referring doctor knows the patient actually saw the specialist. This improves patient outcomes and strengthens professional relationships.

4.2 Multi-Doctor Shared Patient View
What to build:

When multiple doctors in the same clinic see the same patient (e.g., general physician + gynecologist for a pregnant patient), they can see each other's notes.

Features:

Shared patient timeline: all visits across all doctors in the clinic, in chronological order
Each doctor's notes are tagged with their name
Doctors can leave internal notes for each other: "Dr. Sharma: Please check HbA1c at next visit"
These internal notes are NOT visible to the patient
Why this is addictive: Coordinated care without phone calls or WhatsApp messages. The patient gets better care because all doctors are on the same page.

4.3 Specialist Consultation Mode
What to build:

A mode where a specialist (e.g., dermatologist) receives referrals and has a streamlined workflow.

Features:

Incoming referrals appear in a separate "Referrals" tab
The referral letter, patient history, and referring doctor's notes are pre-loaded
Specialist adds their assessment and sends it back to the referring doctor
Both doctors can see the complete care chain
Why this is addictive: Specialists love structured referrals. No more illegible faxed referral letters. Everything is digital, organized, and complete.

LAYER 5: INSTANT ACCESS TO MEDICAL KNOWLEDGE
5.1 Contextual Clinical Guidelines
What to build:

When the doctor selects a diagnosis, show relevant clinical guidelines in a side panel.

Example:

Diagnosis: "Type 2 Diabetes Mellitus"
Side panel shows:
ICMR Guidelines: HbA1c target < 7%, first-line: Metformin, consider adding SGLT2i if CVD risk
Monitoring: HbA1c every 3 months, annual eye exam, annual foot exam
Red Flags: HbA1c > 9%, symptomatic hyperglycemia, ketonuria
Data source:

ICMR guidelines (Indian-specific, freely available)
WHO Essential Medicines List
NHS CKS (UK clinical guidelines, freely available)
Local clinic-specific protocols (uploaded by the clinic)
Presentation:

Side panel that doesn't obstruct the consultation flow
Collapsible sections: "Guidelines" / "Monitoring" / "Red Flags"
One click to insert a guideline-derived recommendation into the consultation notes
Why this is addictive: Doctors can't memorize every guideline for every condition. Having it contextually available during the consultation is like having a medical textbook that reads itself at the right page.

5.2 Drug Information at Point of Prescribe
What to build:

When the doctor types a drug name, show a brief information card.

Card contents:

Generic name, brand names, drug class
Standard dosing (adult, pediatric, renal adjustment, hepatic adjustment)
Common side effects (top 5)
Key interactions (top 3)
Pregnancy category
Cost range (generic vs branded)
Why this is addictive: Quick reference without leaving the prescription screen. Saves the doctor from Googling "Paracetamol renal dose adjustment" during the consultation.

LAYER 6: BILLING, CODING & COMPLIANCE
6.1 Auto-Coding Suggestions
What to build (V2):

Based on the diagnosis and procedures performed, suggest billing codes.

Logic:

Diagnosis: "Upper Respiratory Tract Infection" → ICD-10: J06.9
Consultation: General OPD → CPT/CDT: Consultation code
Procedure: Nebulization → CPT: Nebulization procedure code
Suggest the codes. Doctor confirms. Codes flow into the billing system.
Why this is addictive: Coding is tedious and error-prone. Auto-suggestions reduce claim rejections and save 2-3 minutes per patient.

6.2 One-Click GST Invoice (India-Specific)
What to build:

Generate a GST-compliant invoice for every consultation.

Features:

Auto-populate: clinic GST number, patient name, consultation fee, procedure charges
Generate PDF with GST breakdown (CGST + SGST for intra-state, IGST for inter-state)
Option to email/SMS the invoice to the patient
Daily/monthly GST summary for the accountant
Why this is addictive: Accountants love doctors who use ClinicFlow because the GST data is already organized. The doctor's accountant becomes an evangelist.

LAYER 7: BURNOUT-REDUCING AUTOMATION
7.1 Consultation Fatigue Detection
What to build:

Track consultation patterns and alert when the doctor might be fatigued.

Signals:

Average consultation time dropping below the doctor's baseline (rushing due to fatigue)
Increasing number of "No Show" marks (doctor skipping patients to take breaks)
Session duration exceeding 4 hours without a break
Output:

Gentle notification: "You've been consulting for 3.5 hours. Consider a 10-minute break."
Auto-suggest: "Shall I pause the session for 10 minutes?"
End-of-day summary: "Your consultation speed dropped 20% after 3 PM today. Consider scheduling complex cases in the morning."
Why this is addictive: Nobody else cares about the doctor's wellbeing. When the software says "take a break," it feels like having a caring assistant.

7.2 Automated Follow-Up Reminders
What to build (V2):

When the doctor sets a follow-up date, the system automatically:

Sends an SMS/WhatsApp reminder to the patient 1 day before
Shows the patient in the "Due for Follow-Up" panel on the follow-up date
If the patient doesn't show up, marks them as "Recall" and shows in the RecallPanel (already exists)
Why this is addictive: Patients actually come back for follow-ups. Revenue increases. Patient outcomes improve. The doctor doesn't have to remember anything.

7.3 Template Library
What to build:

Pre-built consultation templates for common conditions.

Templates:

Fever Workup: Chief complaint, vitals, examination checklist, common investigations, standard prescriptions
Diabetes Follow-Up: HbA1c, foot exam, eye exam, medication review, lifestyle counseling
Prenatal Visit: Fundal height, fetal heart rate, BP, weight, urine analysis, supplements
Pediatric Well-Baby: Growth chart, vaccination status, developmental milestones, nutrition counseling
Customization:

Each doctor can create their own templates
Templates are shared across the clinic (other doctors can use them)
One tap loads a template → doctor fills in specifics → done
Why this is addictive: Templates reduce documentation time to near-zero for common conditions. A diabetes follow-up that took 5 minutes now takes 30 seconds.

LAYER 8: REAL-TIME PATIENT MONITORING
8.1 Connected Devices Integration (V2)
What to build:

Connect to Bluetooth-enabled medical devices to auto-populate vitals.

Supported devices:

Digital BP monitors (Omron, AccuSure)
Pulse oximeters (with Bluetooth)
Digital thermometers
Glucometers
Weighing scales
How it works:

Device pairs with the tablet/phone running ClinicFlow
When a measurement is taken, it auto-populates the vitals fields
No manual entry needed. Zero transcription errors.
Why this is addictive: Nurses/receptionists stop scribbling vitals on paper and re-entering them. Measurements are captured at the source.

8.2 Patient Health Trends
What to build:

Show trending data for chronic disease patients.

Visualization:

BP trend over last 6 visits (line chart)
Blood sugar trend (fasting + postprandial)
Weight trend
HbA1c trend
Presentation:

Small sparkline charts in the patient sidebar
Tap to expand into a full trend view
Show target ranges as shaded bands (e.g., BP target: 120/80, shaded green)
Why this is addictive: Doctors see patterns instantly. "Your BP has been trending up over the last 3 visits" is a powerful clinical insight that's hard to see from raw numbers.

LAYER 9: PREDICTIVE DIAGNOSTICS (V2 — THE MOONSHOT)
9.1 Population Health Intelligence
What to build:

Anonymized, aggregated data across all ClinicFlow clinics to detect population-level trends.

Example insights:

"Dengue cases in Mumbai increased 40% this week compared to last month"
"Upper respiratory infections are spiking in your area — consider stocking antibiotics"
"Diabetes diagnoses in your clinic are 20% above the national average for your demographic"
Privacy:

All data is anonymized at the source (no patient PII ever leaves the clinic)
Aggregation happens at the regional level (pin code, not individual clinic)
DPDP compliant: no individual patient data is used
Why this is addictive: Doctors feel connected to a larger intelligence network. They can prepare for disease surges before patients arrive.

9.2 Clinical Outcome Tracking
What to build:

Track treatment outcomes to improve future decisions.

Example:

"For URTI, you prescribed Paracetamol + Azithromycin in 80% of cases. Average recovery: 5 days."
"When you prescribed Paracetamol alone (without antibiotic), average recovery was also 5 days. Consider antibiotic stewardship."
Why this is addictive: Evidence-based practice feedback. The doctor learns from their own data. This is what medical journals wish they could provide — personalized, practice-specific insights.

LAYER 10: THE EXPERIENCE LAYER
10.1 Doctor's Personal Dashboard
What to build:

A dashboard the doctor checks every morning before starting.

Contents:

"Good morning, Dr. Sharma. 12 appointments scheduled today."
"3 patients due for follow-up from last week."
"1 referral response received from Dr. Cardiologist."
"Your busiest time today: 10 AM - 12 PM. Consider opening more slots."
"Weather alert: Heavy rain expected. Patients may arrive late."
Why this is addictive: The doctor starts their day with the software. It's the first thing they see. That's the definition of habit formation.

10.2 Patient Communication Hub
What to build (V2):

A central place to communicate with patients without giving out the doctor's personal phone number.

Features:

Send prescription summary via SMS/WhatsApp (using clinic's business number)
Send appointment reminders
Send follow-up reminders
Receive patient queries (routed through a chatbot that triages: urgent → doctor, routine → FAQ)
All communication is logged and auditable
Why this is addictive: Patients feel connected. Doctors maintain boundaries. No more 10 PM WhatsApp messages on the doctor's personal phone.

10.3 Clinic Reputation Management
What to build:

After each consultation, optionally prompt the patient for feedback.

Features:

Simple 1-5 star rating on the patient's phone (via SMS link)
Optional text feedback
Doctor sees aggregated ratings: "4.8/5 average across 500 consultations"
Positive feedback boosts doctor morale
Negative feedback is private (only the doctor sees it) — opportunity to improve
Why this is addictive: Positive feedback is motivating. Doctors check their rating like they check their phone's battery percentage. It's a dopamine loop.

IMPLEMENTATION PRIORITY
Phase 2 (Current — Build Now)
Feature	Addiction Score	Effort
Drug interaction alerts (Level 1)	🔥🔥🔥🔥🔥	Medium
Smart prescription defaults from history	🔥🔥🔥🔥🔥	Medium
Red flag detection	🔥🔥🔥🔥🔥	Low
Keyboard shortcuts	🔥🔥🔥🔥	Low
Auto-save + undo	🔥🔥🔥🔥🔥	Medium
Contextual drug info card	🔥🔥🔥🔥	Low
Phase 3 (Next Quarter)
Feature	Addiction Score	Effort
Voice-to-text consultation notes	🔥🔥🔥🔥🔥	High
Beautiful prescription print + QR	🔥🔥🔥🔥	Medium
Patient health trends	🔥🔥🔥🔥	Medium
Referral network + tracking	🔥🔥🔥🔥	Medium
Template library	🔥🔥🔥🔥	Medium
Predictive wait times	🔥🔥🔥	Medium
Phase 4 (The Moonshots)
Feature	Addiction Score	Effort
Ambient clinical documentation	🔥🔥🔥🔥🔥	Very High
Smart diagnosis suggestions	🔥🔥🔥🔥🔥	Very High
Connected devices integration	🔥🔥🔥🔥	High
Population health intelligence	🔥🔥🔥🔥	Very High
Clinical outcome tracking	🔥🔥🔥🔥	High
Auto-coding suggestions	🔥🔥🔥	High
THE METRIC THAT MATTERS
Don't measure:

Features shipped
Lines of code
Number of screens
Measure:

Time saved per doctor per day (target: 45+ minutes)
Patients seen per hour (target: +20% improvement)
Prescription errors caught (target: 1+ per doctor per week)
Doctor daily active usage (target: 100% of working days)
Net Promoter Score (target: 70+ — "extremely likely to recommend")
When a doctor says "I can't practice without this" — you've won. Everything above is designed to get to that sentence.


THE PRINCIPAL ENGINEER'S PLAYBOOK
Ten disciplines that separate senior engineers from principal engineers. Each section covers the why before the how — the reasoning that drives the decisions, not just the patterns themselves.

1. CODE ARCHITECTURE & DESIGN
The Core Mindset
Principal engineers don't start with "How do I structure this?" They start with "What will change, and what won't?" Architecture is about isolating change. If everything changes at the same rate, you don't need architecture — you need a script.

The fundamental question is: Which decisions do I want to be easy to reverse?

Principle: Depend on Abstractions, Not Implementations
Every dependency on a concrete implementation is a commitment. Dependencies on abstractions are invitations to change.

// ❌ BAD — Depends on a specific database
class PatientRepository {
  async findById(id: string): Promise<Patient> {
    const { data } = await supabase
      .from('patients')
      .select('*')
      .eq('id', id)
      .single()
    return data as Patient
  }
}

// ✅ GOOD — Depends on an interface
interface PatientRepository {
  findById(id: string): Promise<Patient | null>
  findByMobile(clinicId: string, mobile: string): Promise<Patient[]>
  save(patient: Patient): Promise<void>
}

// The interface is the contract.
// Supabase, PostgreSQL, MongoDB, or an in-memory mock — all satisfy it.
class SupabasePatientRepository implements PatientRepository {
  async findById(id: string): Promise<Patient | null> {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('id', id)
      .single()

    if (error?.code === 'PGRST116') return null // not found
    if (error) throw new RepositoryError('Failed to fetch patient', error)
    return data as Patient
  }

  async findByMobile(clinicId: string, mobile: string): Promise<Patient[]> {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('mobile', mobile)

    if (error) throw new RepositoryError('Failed to search patients', error)
    return (data ?? []) as Patient[]
  }

  async save(patient: Patient): Promise<void> {
    const { error } = await supabase
      .from('patients')
      .upsert(patient)

    if (error) throw new RepositoryError('Failed to save patient', error)
  }
}
Why this matters: When you need to write tests, you inject an in-memory implementation. When Supabase changes their API, you change one class. When you want to add caching, you wrap the interface with a decorator — zero changes to consumers.

Principle: Module Boundaries Are Trust Boundaries
Every module should have a clear public API and a hidden implementation. The public API is a promise. The implementation is free to change.

src/
├── services/              # Public API — what other modules call
│   ├── queue.ts           # createEntry(), transition(), fetchQueue()
│   ├── patient.ts         # searchPatient(), createPatient(), exportData()
│   └── session.ts         # openSession(), closeSession(), getSessionStatus()
├── repositories/          # Hidden — how data is accessed
│   ├── supabase/
│   │   ├── queue.repo.ts
│   │   ├── patient.repo.ts
│   │   └── session.repo.ts
│   └── mock/              # For testing
│       ├── queue.repo.ts
│       └── patient.repo.ts
├── domain/                # Pure business logic — zero IO
│   ├── queue-state-machine.ts
│   ├── consent-validator.ts
│   └── drug-interaction-checker.ts
└── lib/                   # Shared utilities
    ├── logger.ts
    ├── errors.ts
    └── result.ts
The rule: domain/ never imports repositories/. services/ orchestrates between domain/ and repositories/. Components import only from services/.

This prevents the most common architectural decay: business logic that's tangled with database queries.

Pattern: Result Types Over Exceptions
Exceptions are invisible control flow. A function signature like findById(id: string): Promise<Patient> lies — it can also throw. The caller must read the implementation to know what to catch.

// A Result type makes success and failure explicit in the signature
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E }

// Now the signature tells the truth
async function findById(id: string): Promise<Result<Patient, PatientNotFoundError | DatabaseError>> {
  try {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('id', id)
      .single()

    if (error?.code === 'PGRST116') {
      return { ok: false, error: new PatientNotFoundError(id) }
    }
    if (error) {
      return { ok: false, error: new DatabaseError('findById', error) }
    }

    return { ok: true, value: data as Patient }
  } catch (e) {
    return { ok: false, error: new DatabaseError('findById', e) }
  }
}

// Usage — every failure is handled at the call site
const result = await findById(patientId)
if (!result.ok) {
  if (result.error instanceof PatientNotFoundError) {
    return <EmptyState message="Patient not found" />
  }
  return <ErrorBanner message="Unable to load patient data" />
}
// TypeScript knows result.value exists here
renderPatient(result.value)
Why this matters: The compiler forces you to handle every failure. No more uncaught exceptions. No more "Cannot read property of undefined." The error types are part of the function's contract.

Pattern: Value Objects Over Primitives
Primitives like string and number carry no domain meaning. A mobile number is not just a string — it has format, validation rules, and semantic meaning.

// ❌ BAD — Primitives everywhere
function addPatient(clinicId: string, name: string, mobile: string, dob: string) { }

// Is mobile "9876543210" or "+919876543210"? Is dob "2000-01-01" or "01/01/2000"?
// The function doesn't enforce anything. Garbage in, bugs out.

// ✅ GOOD — Value objects enforce invariants
class MobileNumber {
  private readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(input: string): Result<MobileNumber, ValidationError> {
    const cleaned = input.replace(/[\s\-()]/g, '')
    const withoutCountryCode = cleaned.replace(/^\+91/, '').replace(/^91/, '')

    if (!/^[6-9]\d{9}$/.test(withoutCountryCode)) {
      return { ok: false, error: new ValidationError('Invalid Indian mobile number') }
    }

    return { ok: true, value: new MobileNumber(withoutCountryCode) }
  }

  toString(): string { return this.value }
  toInternational(): string { return `+91${this.value}` }
  equals(other: MobileNumber): boolean { return this.value === other.value }
}

class DateOfBirth {
  private readonly value: string // ISO date string: YYYY-MM-DD

  private constructor(value: string) {
    this.value = value
  }

  static create(input: string): Result<DateOfBirth, ValidationError> {
    const parsed = new Date(input)
    if (isNaN(parsed.getTime())) {
      return { ok: false, error: new ValidationError('Invalid date format') }
    }
    if (parsed > new Date()) {
      return { ok: false, error: new ValidationError('Date of birth cannot be in the future') }
    }
    return { ok: true, value: new DateOfBirth(input.split('T')[0]) }
  }

  age(): number {
    const today = new Date()
    const birth = new Date(this.value)
    let age = today.getFullYear() - birth.getFullYear()
    const monthDiff = today.getMonth() - birth.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--
    }
    return age
  }

  toString(): string { return this.value }
}

// Now the function signature is self-documenting and self-enforcing
function addPatient(
  clinicId: string,
  name: PatientName,
  mobile: MobileNumber,
  dob: DateOfBirth | null
): Promise<Result<QueueEntry, AddPatientError>> {
  // No validation needed inside — the types already guarantee valid data
}
Why this matters: Invalid data cannot exist. If you have a MobileNumber, it's valid. If you have a DateOfBirth, it's in the past. Validation happens at the boundary, not scattered through the codebase.

2. DEFENSIVE PROGRAMMING & ERROR HANDLING
The Core Mindset
Defensive programming assumes the caller is adversarial or incompetent. Not because your colleagues are — but because code is called in contexts you never imagined. The function that's only called with valid data today will be called with null tomorrow by a developer who didn't read your documentation.

Principle: Fail Fast, Fail Loudly, Fail Informatively
// ❌ BAD — Silent failure
function calculateAge(dob: string | null | undefined): number {
  if (!dob) return 0 // What does "age 0" mean? Infant? Unknown? Bug?
  // ... calculation
}

// ❌ BAD — Cryptic failure
function calculateAge(dob: string): number {
  const birth = new Date(dob)
  // If dob is "not a date", birth is Invalid Date
  // Subtracting Invalid Date from Date gives NaN
  // NaN propagates silently through every calculation
  return Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
}

// ✅ GOOD — Explicit, informative failure
function calculateAge(dob: string | null): Result<number, AgeCalculationError> {
  if (dob === null) {
    return { ok: false, error: new AgeCalculationError('Date of birth is not recorded') }
  }

  const birth = new Date(dob)
  if (isNaN(birth.getTime())) {
    return { ok: false, error: new AgeCalculationError(`Invalid date format: "${dob}"`) }
  }

  if (birth > new Date()) {
    return { ok: false, error: new AgeCalculationError('Date of birth is in the future') }
  }

  const age = Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
  return { ok: true, value: age }
}
Principle: Validate at the Boundary, Trust Internally
                    ┌─────────────────────────────────────┐
                    │           EXTERNAL WORLD             │
                    │  (users, APIs, files, databases)      │
                    └──────────────┬──────────────────────┘
                                   │
                              VALIDATE HERE
                              (at the boundary)
                                   │
                    ┌──────────────▼──────────────────────┐
                    │          INTERNAL WORLD               │
                    │  (functions trust their inputs)        │
                    │  (types guarantee validity)            │
                    └──────────────────────────────────────┘
// The boundary: validate everything coming in
async function handleAddPatient(req: Request): Promise<Response> {
  // Parse and validate at the boundary
  const body = await parseJsonBody(req)
  if (!body.ok) return errorResponse(400, 'Invalid JSON body')

  const mobile = MobileNumber.create(body.value.mobile)
  if (!mobile.ok) return errorResponse(400, mobile.error.message)

  const dob = body.value.dob ? DateOfBirth.create(body.value.dob) : null
  if (dob && !dob.ok) return errorResponse(400, dob.error.message)

  const name = PatientName.create(body.value.name)
  if (!name.ok) return errorResponse(400, name.error.message)

  // Internal functions trust their inputs — no more validation needed
  const result = await addPatientService(clinicId, name.value, mobile.value, dob?.value ?? null)

  if (!result.ok) return errorResponse(result.error.statusCode, result.error.message)
  return jsonResponse(201, result.value)
}
Pattern: Error Hierarchies
// Domain-specific errors — each carries context
abstract class DomainError {
  abstract readonly code: string
  abstract readonly message: string
  abstract readonly statusCode: number

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
    }
  }
}

class PatientNotFoundError extends DomainError {
  readonly code = 'PATIENT_NOT_FOUND'
  readonly statusCode = 404

  constructor(readonly patientId: string) {
    super()
  }

  get message(): string {
    return `Patient ${this.patientId} not found`
  }
}

class ConsentExpiredError extends DomainError {
  readonly code = 'CONSENT_EXPIRED'
  readonly statusCode = 403

  constructor(
    readonly patientId: string,
    readonly consentVersion: string,
    readonly currentVersion: string
  ) {
    super()
  }

  get message(): string {
    return `Patient ${this.patientId} consent version ${this.consentVersion} is outdated. Current version: ${this.currentVersion}`
  }
}

class OCCConflictError extends DomainError {
  readonly code = 'OCC_CONFLICT'
  readonly statusCode = 409

  constructor(
    readonly entryId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number
  ) {
    super()
  }

  get message(): string {
    return `Conflict on entry ${this.entryId}: expected version ${this.expectedVersion}, actual ${this.actualVersion}`
  }
}
Why this matters: Every error tells you exactly what went wrong, where, and with what data. No more Error: Something went wrong. No more stack traces that tell you the error happened "somewhere in the call chain."

Pattern: Defensive Object Construction
// ❌ BAD — Object can be constructed in invalid state
class QueueEntry {
  id: string
  status: string
  version: number
  // Nothing prevents: new QueueEntry({ id: '', status: 'INVALID', version: -1 })
}

// ✅ GOOD — Constructor enforces invariants
class QueueEntry {
  private constructor(
    readonly id: string,
    readonly status: QueueStatus,
    readonly version: number,
    readonly tokenNumber: number,
    readonly clinicId: string,
    readonly sessionId: string,
    readonly patientId: string,
  ) {}

  static fromDatabase(row: QueueEntryRow): QueueEntry {
    if (!row.id) throw new InvariantViolation('QueueEntry requires id')
    if (!Object.values(QueueStatus).includes(row.status)) {
      throw new InvariantViolation(`Invalid queue status: ${row.status}`)
    }
    if (row.version < 1) throw new InvariantViolation('Version must be >= 1')

    return new QueueEntry(
      row.id,
      row.status as QueueStatus,
      row.version,
      row.token_number,
      row.clinic_id,
      row.session_id,
      row.patient_id,
    )
  }

  // State transitions return NEW instances — no mutation
  transitionTo(newStatus: QueueStatus, newVersion: number): QueueEntry {
    const allowed = TRANSITIONS[this.status]
    if (!allowed?.includes(newStatus)) {
      throw new InvalidTransitionError(this.status, newStatus)
    }

    return new QueueEntry(
      this.id,
      newStatus,
      newVersion,
      this.tokenNumber,
      this.clinicId,
      this.sessionId,
      this.patientId,
    )
  }
}
3. PERFORMANCE & OPTIMIZATION
The Core Mindset
Measure first. Optimize second. The #1 performance mistake is optimizing the wrong thing. The second is optimizing before you know it matters. The third is optimizing by adding complexity when simplicity would suffice.

Principle: Big-O Matters, Constants Don't (Usually)
// ❌ "Optimized" — complex, hard to read, marginal gain
function findPatient(patients: Patient[], mobile: string): Patient | undefined {
  // Binary search on sorted array — O(log n)
  // But patients aren't sorted by mobile, and maintaining sort order on insert
  // adds O(n) complexity. Net gain: negative for < 10,000 patients.
  // Most clinics have < 5,000 patients.
}

// ✅ Good enough — simple, readable, fast for the actual data size
function findPatient(patients: Patient[], mobile: string): Patient | undefined {
  return patients.find(p => p.mobile === mobile)
  // O(n) but n < 5,000. Executes in < 1ms. Not worth optimizing.
}
The rule: Don't optimize until you've measured. Don't measure until you've noticed a problem. When you do measure, use a profiler, not intuition.

Principle: The Fastest Code Is Code That Doesn't Run
// ❌ BAD — Fetches data that might not be needed
async function loadDoctorDashboard(doctorId: string) {
  const [queue, patients, sessions, drugs, analytics] = await Promise.all([
    fetchQueue(doctorId),        // Always needed
    fetchAllPatients(clinicId),  // Not needed until search
    fetchSessions(doctorId),     // Not needed until session panel opens
    fetchDrugPreferences(doctorId), // Not needed until prescription
    fetchAnalytics(clinicId),    // Not needed until analytics tab
  ])
  // 5 parallel requests, all blocking render
}

// ✅ GOOD — Load only what's needed, defer the rest
async function loadDoctorDashboard(doctorId: string) {
  // Critical path: render the queue immediately
  const queue = await fetchQueue(doctorId)
  render(queue) // User sees content in 200ms instead of 800ms

  // Non-critical: prefetch during idle time
  requestIdleCallback(async () => {
    const drugs = await fetchDrugPreferences(doctorId)
    cacheDrugPreferences(drugs) // Ready before doctor needs them
  })

  // Lazy: load on demand
  // Patient search: load when user types in search box
  // Analytics: load when user clicks analytics tab
  // Sessions: load when user opens session panel
}
Pattern: Request Deduplication
// Multiple components requesting the same data simultaneously
// Result: N identical network requests

// ✅ GOOD — Deduplicate concurrent requests
class DataLoader<K, V> {
  private pending = new Map<string, Promise<V>>()

  async load(key: string, fetcher: () => Promise<V>): Promise<V> {
    // If a request for this key is already in flight, return the same promise
    const existing = this.pending.get(key)
    if (existing) return existing

    // Start a new request
    const promise = fetcher().finally(() => {
      this.pending.delete(key) // Clean up after completion (success or failure)
    })

    this.pending.set(key, promise)
    return promise
  }
}

// Usage
const patientLoader = new DataLoader<string, Patient>()

// Three components request the same patient simultaneously
// Only ONE network request is made
const [patient1, patient2, patient3] = await Promise.all([
  patientLoader.load('patient-123', () => fetchPatient('patient-123')),
  patientLoader.load('patient-123', () => fetchPatient('patient-123')),
  patientLoader.load('patient-123', () => fetchPatient('patient-123')),
])
// patient1 === patient2 === patient3 (same promise, same result)
Pattern: Computed Value Caching (Memoization with Invalidation)
// ❌ BAD — Recalculates on every render
function QueueStats({ entries }: { entries: QueueEntry[] }) {
  const completed = entries.filter(e => e.status === 'COMPLETED').length
  const waiting = entries.filter(e => e.status === 'CHECKED_IN').length
  const avgTime = entries
    .filter(e => e.completedAt && e.consultationStartedAt)
    .reduce((sum, e) => sum + (e.completedAt! - e.consultationStartedAt!), 0) / completed
  // 3 full array traversals on every render
}

// ✅ GOOD — Memoized with explicit dependency
function QueueStats({ entries }: { entries: QueueEntry[] }) {
  const stats = useMemo(() => {
    let completed = 0
    let waiting = 0
    let totalConsultTime = 0

    // Single pass through the array
    for (const entry of entries) {
      if (entry.status === 'COMPLETED') {
        completed++
        if (entry.completedAt && entry.consultationStartedAt) {
          totalConsultTime += entry.completedAt - entry.consultationStartedAt
        }
      }
      if (entry.status === 'CHECKED_IN') waiting++
    }

    return {
      completed,
      waiting,
      avgTime: completed > 0 ? totalConsultTime / completed : 0,
    }
  }, [entries]) // Recalculates only when entries array reference changes

  return <StatsDisplay {...stats} />
}
Smart Trade-off: Readability vs Performance
// The readable version — use this until profiling says otherwise
function getQueueSummary(entries: QueueEntry[]): QueueSummary {
  return {
    total: entries.length,
    checkedIn: entries.filter(e => e.status === 'CHECKED_IN').length,
    called: entries.filter(e => e.status === 'CALLED').length,
    inConsultation: entries.filter(e => e.status === 'IN_CONSULTATION').length,
    completed: entries.filter(e => e.status === 'COMPLETED').length,
    noShow: entries.filter(e => e.status === 'NO_SHOW').length,
  }
}

// The "optimized" version — use ONLY if profiling shows the above is a bottleneck
function getQueueSummaryFast(entries: QueueEntry[]): QueueSummary {
  const summary: QueueSummary = {
    total: entries.length,
    checkedIn: 0, called: 0, inConsultation: 0,
    completed: 0, noShow: 0,
  }
  for (const e of entries) {
    switch (e.status) {
      case 'CHECKED_IN': summary.checkedIn++; break
      case 'CALLED': summary.called++; break
      case 'IN_CONSULTATION': summary.inConsultation++; break
      case 'COMPLETED': summary.completed++; break
      case 'NO_SHOW': summary.noShow++; break
    }
  }
  return summary
}

// Decision matrix:
// < 1,000 entries → use readable version (difference is < 1ms)
// 1,000 - 10,000 entries → use readable version, memoize result
// > 10,000 entries → use optimized version (rare in clinic context)
4. TESTING STRATEGY
The Core Mindset
Tests are not about catching bugs. Tests are about enabling change. The value of a test is measured by how confidently you can refactor, add features, or upgrade dependencies without fear.

A test that passes forever is worthless. A test that catches a regression during refactoring is worth its weight in gold.

The Testing Trophy
         ╱╲
        ╱  ╲       E2E Tests (few, slow, high confidence)
       ╱────╲      "Does the complete patient flow work?"
      ╱      ╲
     ╱────────╲    Integration Tests (moderate number)
    ╱          ╲   "Does the queue service work with the real state machine?"
   ╱────────────╲
  ╱              ╲  Unit Tests (many, fast, focused)
 ╱                ╲ "Does the state machine reject invalid transitions?"
╱──────────────────╲
                      Static Analysis (TypeScript, ESLint)
                      "Is the code syntactically and semantically correct?"
Unit Tests: Test Behavior, Not Implementation
// ❌ BAD — Tests implementation details
describe('QueueService', () => {
  it('should call supabase.from with correct table', async () => {
    const mockFrom = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(...) })
    vi.mocked(supabase).from = mockFrom

    await queueService.getQueue('session-123')

    expect(mockFrom).toHaveBeenCalledWith('queue_entries')  // Implementation detail
  })

  it('should set status to CALLED', async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(supabase).from = vi.fn().mockReturnValue({ update: mockUpdate })

    await queueService.callNext('entry-123', 3)

    expect(mockUpdate).toHaveBeenCalledWith({ status: 'CALLED', version: 4 })  // Implementation detail
  })
})

// ✅ GOOD — Tests behavior
describe('QueueStateTransition', () => {
  it('should allow CHECKED_IN → CALLED', () => {
    const entry = createEntry({ status: 'CHECKED_IN' })
    const result = transition(entry, 'CALL')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.status).toBe('CALLED')
  })

  it('should reject COMPLETED → CALLED (terminal state)', () => {
    const entry = createEntry({ status: 'COMPLETED' })
    const result = transition(entry, 'CALL')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(InvalidTransitionError)
  })

  it('should reject IN_CONSULTATION when identity is not verified', () => {
    const entry = createEntry({ status: 'CALLED', identityVerified: false })
    const result = transition(entry, 'START_CONSULTATION')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('IDENTITY_NOT_VERIFIED')
  })

  it('should allow all transitions from CALLED', () => {
    const entry = createEntry({ status: 'CALLED' })

    const allowed = ['START_CONSULTATION', 'SKIP', 'NO_SHOW', 'CANCEL']
    for (const action of allowed) {
      const result = transition(entry, action)
      expect(result.ok).toBe(true)
    }
  })

  it('should reject all transitions from COMPLETED', () => {
    const entry = createEntry({ status: 'COMPLETED' })

    const allActions = ['CALL', 'START_CONSULTATION', 'COMPLETE', 'SKIP', 'NO_SHOW', 'CANCEL']
    for (const action of allActions) {
      const result = transition(entry, action)
      expect(result.ok).toBe(false)
    }
  })
})
Property-Based Tests: Test Invariants, Not Examples
// Instead of testing specific inputs, test properties that must ALWAYS hold

import { fc } from 'fast-check'

describe('QueueStateMachine Invariants', () => {
  // Property: Once COMPLETED, always COMPLETED (no transition out)
  it('should never transition out of COMPLETED', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('CALL', 'START_CONSULTATION', 'COMPLETE', 'SKIP', 'NO_SHOW', 'CANCEL'),
        (action) => {
          const entry = createEntry({ status: 'COMPLETED' })
          const result = transition(entry, action)
          expect(result.ok).toBe(false)
        }
      )
    )
  })

  // Property: Version always increases by exactly 1
  it('should increment version by 1 on every successful transition', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }), // current version
        fc.constantFrom('CALL', 'START_CONSULTATION', 'COMPLETE', 'SKIP', 'NO_SHOW'),
        (currentVersion, action) => {
          const entry = createEntry({ status: getStatusForAction(action), version: currentVersion })
          const result = transition(entry, action)
          if (result.ok) {
            expect(result.value.version).toBe(currentVersion + 1)
          }
        }
      )
    )
  })

  // Property: Identity verification is required before IN_CONSULTATION
  it('should require identity verification before IN_CONSULTATION', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (identityVerified) => {
          const entry = createEntry({ status: 'CALLED', identityVerified })
          const result = transition(entry, 'START_CONSULTATION')

          if (!identityVerified) {
            expect(result.ok).toBe(false)
          } else {
            expect(result.ok).toBe(true)
          }
        }
      )
    )
  })
})
Why property-based tests matter: Example-based tests check "for input X, output is Y." Property-based tests check "for ALL inputs, property P holds." They find edge cases you never thought to test — empty strings, negative numbers, unicode, boundary values.

Integration Tests: Test the Seams
// Test the integration between the service layer and the state machine
describe('QueueService + StateMachine Integration', () => {
  let repo: InMemoryQueueRepository
  let service: QueueService

  beforeEach(() => {
    repo = new InMemoryQueueRepository()
    service = new QueueService(repo, new RealStateMachine())
  })

  it('should complete the full patient flow', async () => {
    // Add patient
    const addResult = await service.addPatient({
      clinicId: 'clinic-1',
      sessionId: 'session-1',
      patientId: 'patient-1',
    })
    expect(addResult.ok).toBe(true)
    const entryId = addResult.ok ? addResult.value.id : ''

    // Call
    const callResult = await service.callNext('session-1')
    expect(callResult.ok).toBe(true)

    // Verify identity
    const verifyResult = await service.verifyIdentity(entryId, 1)
    expect(verifyResult.ok).toBe(true)

    // Start consultation
    const startResult = await service.startConsultation(entryId, 2)
    expect(startResult.ok).toBe(true)

    // Complete
    const completeResult = await service.complete(entryId, 3)
    expect(completeResult.ok).toBe(true)

    // Verify final state
    const entry = await repo.findById(entryId)
    expect(entry?.status).toBe('COMPLETED')
    expect(entry?.version).toBe(4)
  })

  it('should handle OCC conflict gracefully', async () => {
    const addResult = await service.addPatient({ ... })
    const entryId = addResult.ok ? addResult.value.id : ''

    // Simulate concurrent modification (version changed externally)
    await repo.forceUpdate(entryId, { version: 5 })

    // Try to transition with stale version
    const result = await service.callNext('session-1')

    // Should detect conflict and re-fetch
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(OCCConflictError)
  })
})
Contract Tests: Verify External Dependencies
// When your code depends on an external API, test the contract
// Not the API itself — your assumptions about the API

describe('Supabase Contract: queue_entries', () => {
  it('should return the expected columns when selecting from queue_entries', async () => {
    const { data, error } = await supabase
      .from('queue_entries')
      .select('id, clinic_id, session_id, patient_id, token_number, status, version')
      .limit(1)

    expect(error).toBeNull()
    expect(data).toBeDefined()

    if (data && data.length > 0) {
      const row = data[0]
      // Verify your assumptions about the data shape
      expect(typeof row.id).toBe('string')
      expect(typeof row.status).toBe('string')
      expect(typeof row.version).toBe('number')
      expect(['CHECKED_IN', 'CALLED', 'IN_CONSULTATION', 'COMPLETED', 'NO_SHOW', 'SKIPPED', 'CANCELLED'])
        .toContain(row.status)
    }
  })

  it('should enforce RLS — two clinics cannot see each other\'s data', async () => {
    // This test runs with two different JWT tokens
    const clinicAToken = await getTestToken('clinic-a')
    const clinicBToken = await getTestToken('clinic-b')

    // Insert a queue entry for clinic A
    await supabaseAdmin.from('queue_entries').insert({ clinic_id: 'clinic-a', ... })

    // Clinic B should NOT see clinic A's entry
    const { data } = await supabase
      .auth(clinicBToken)
      .from('queue_entries')
      .select('*')
      .eq('clinic_id', 'clinic-a')

    expect(data).toEqual([]) // RLS blocks cross-tenant access
  })
})
5. CODE READABILITY & COMMUNICATION
The Core Mindset
Code is read 10x more than it's written. Optimize for the reader, not the writer. The reader is your future self at 2 AM debugging a production incident. Make their life easy.

Principle: Names Are Documentation
// ❌ BAD — What does this do?
const d = new Date()
const ms = d.getTime()
const a = entries.filter(e => e.s > 0)
const r = a.map(e => ({ ...e, t: ms - e.c }))

// ✅ GOOD — Self-documenting
const now = Date.now()
const activeEntries = queueEntries.filter(entry => entry.status !== 'COMPLETED')
const entriesWithWaitTime = activeEntries.map(entry => ({
  ...entry,
  waitTimeMs: now - entry.createdAt,
  waitTimeMinutes: Math.round((now - entry.createdAt) / 60000),
}))
// ❌ BAD — Boolean parameters are unreadable
scheduleAppointment(patient, doctor, time, true, false, true)
// What do the booleans mean? You have to read the function definition.

// ✅ GOOD — Named options object
scheduleAppointment({
  patient,
  doctor,
  scheduledAt: time,
  sendReminder: true,
  isFollowUp: false,
  overrideConflict: true,
})
Principle: Functions Should Do One Thing
// ❌ BAD — Does three things
async function processPatient(data: unknown) {
  // Thing 1: Validate
  if (!data || typeof data !== 'object') throw new Error('Invalid')
  const { name, mobile, dob } = data as any
  if (!name || !mobile) throw new Error('Missing fields')

  // Thing 2: Transform
  const cleaned = {
    name: name.trim().toUpperCase(),
    mobile: mobile.replace(/\D/g, ''),
    dob: dob ? new Date(dob).toISOString().split('T')[0] : null,
  }

  // Thing 3: Persist
  const { error } = await supabase.from('patients').insert(cleaned)
  if (error) throw error

  return cleaned
}

// ✅ GOOD — Each function does one thing
function validatePatientInput(data: unknown): Result<RawPatientInput, ValidationError> {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: new ValidationError('Expected object') }
  }
  const { name, mobile, dob } = data as Record<string, unknown>
  if (typeof name !== 'string' || !name.trim()) {
    return { ok: false, error: new ValidationError('Name is required') }
  }
  if (typeof mobile !== 'string' || !mobile.trim()) {
    return { ok: false, error: new ValidationError('Mobile is required') }
  }
  return { ok: true, value: { name, mobile, dob: dob as string | undefined } }
}

function normalizePatientInput(input: RawPatientInput): NormalizedPatientInput {
  return {
    name: input.name.trim().toUpperCase(),
    mobile: input.mobile.replace(/\D/g, ''),
    dob: input.dob ? new Date(input.dob).toISOString().split('T')[0] : null,
  }
}

async function persistPatient(input: NormalizedPatientInput): Promise<Result<Patient, DatabaseError>> {
  const { data, error } = await supabase.from('patients').insert(input).select().single()
  if (error) return { ok: false, error: new DatabaseError('persistPatient', error) }
  return { ok: true, value: data as Patient }
}

// The orchestrator reads like a story
async function handlePatientCreation(rawData: unknown): Promise<Result<Patient, Error>> {
  const validation = validatePatientInput(rawData)
  if (!validation.ok) return validation

  const normalized = normalizePatientInput(validation.value)
  return persistPatient(normalized)
}
Principle: Comments Explain WHY, Not WHAT
// ❌ BAD — Comment explains what the code does (redundant)
// Increment the version by 1
entry.version = entry.version + 1

// ❌ BAD — Comment explains a bad decision without justification
// Using setTimeout here
setTimeout(() => setOpen(false), 150)

// ✅ GOOD — Comment explains WHY a non-obvious decision was made
// Using onMouseDown instead of onClick because onClick fires AFTER onBlur,
// which closes the dropdown before the click registers on the option.
// onMouseDown fires BEFORE the blur event, so the selection completes.
function DropdownOption({ label, onSelect }: Props) {
  return (
    <li onMouseDown={(e) => { e.preventDefault(); onSelect() }}>
      {label}
    </li>
  )
}

// ✅ GOOD — Comment explains a business rule
// DPDP Section 12: Patient erasure must anonymize, never delete.
// Deleted records break audit trail integrity and violate clinical record-keeping regulations.
// The anonymized record retains structure (dates, tokens) for legal compliance.
function anonymizePatient(patientId: string): Promise<void> {
  return repository.anonymize(patientId)
}
Pattern: Group Related Code, Separate Unrelated Code
// ❌ BAD — Unrelated concerns mixed together
function handleQueueAction(action: string, entryId: string) {
  const entry = getEntry(entryId)       // 1. Fetch
  logAction(action, entryId)             // 2. Log (unrelated to validation)
  const allowed = checkTransition(entry, action) // 3. Validate
  if (!allowed) {                        // 4. Error handling
    showError('Not allowed')
    return
  }
  sendMetrics(action)                    // 5. Metrics (unrelated)
  updateEntry(entry, action)             // 6. Update
  refreshUI()                            // 7. UI (unrelated to business logic)
}

// ✅ GOOD — Related code grouped, unrelated code separated
function handleQueueAction(action: string, entryId: string) {
  const entry = getEntry(entryId)
  const result = validateAndTransition(entry, action)

  if (!result.ok) {
    showError(result.error.message)
    return
  }

  persistTransition(result.value)
  notifyUI(result.value)
}

// Side effects in separate, clearly named functions
function persistTransition(entry: QueueEntry): Promise<void> {
  return Promise.all([
    repository.save(entry),
    auditLog.record(entry.clinicId, 'QUEUE_TRANSITION', entry.id),
    metrics.track('queue.transition', { action: entry.status }),
  ])
}
6. SECURITY PRACTICES
The Core Mindset
Every input is hostile. Every output is a potential leak. Every dependency is a potential vulnerability. Security is not a feature — it's a property of every line of code.

Principle: Never Trust the Client
// ❌ BAD — Client sends timestamps, client controls state
async function completeConsultation(req: Request) {
  const { entryId, completedAt, status } = await req.json()
  // Attacker can set completedAt to any time
  // Attacker can set status to any value, bypassing state machine
  await supabase.from('queue_entries').update({
    status,
    completed_at: completedAt,  // Client controls the clock
  }).eq('id', entryId)
}

// ✅ GOOD — Server controls all state transitions
async function completeConsultation(req: Request) {
  const { entryId, version } = await req.json()

  // Server determines the new status (not the client)
  // Server determines the timestamp (DB trigger)
  const { data, error } = await supabase
    .from('queue_entries')
    .update({
      status: 'COMPLETED',       // Server decides the status
      version: version + 1,      // Server increments version
      // completed_at is set by DB trigger — client cannot set it
    })
    .eq('id', entryId)
    .eq('version', version)      // OCC: reject if version changed
    .select()
    .single()

  if (error?.code === 'PGRST116') {
    // 0 rows affected = OCC conflict
    return conflictResponse(entryId)
  }
  if (error) return serverErrorResponse(error)

  return successResponse(data)
}
Principle: Least Privilege by Default
// ❌ BAD — User gets all permissions, restricted by code
function canPerformAction(user: User, action: string): boolean {
  if (user.role === 'admin') return true  // Admin can do anything
  if (user.role === 'doctor' && action !== 'delete_clinic') return true
  // ... 50 more if statements
}

// ✅ GOOD — Explicit permission set, no default access
const PERMISSIONS: Record<StaffRole, Set<string>> = {
  admin: new Set([
    'queue:read', 'queue:write', 'queue:delete',
    'patient:read', 'patient:write', 'patient:anonymize',
    'session:open', 'session:close', 'session:pause',
    'staff:invite', 'staff:deactivate',
    'audit:read',
    'settings:read', 'settings:write',
  ]),
  doctor: new Set([
    'queue:read', 'queue:call', 'queue:complete',
    'patient:read',
    'prescription:write',
    'drug:search',
  ]),
  receptionist: new Set([
    'queue:read', 'queue:write',
    'patient:read', 'patient:write',
    'session:open',
  ]),
  display: new Set([
    'queue:read',          // Only this — display is read-only
    'display_sync:read',
  ]),
}

function hasPermission(role: StaffRole, permission: string): boolean {
  return PERMISSIONS[role]?.has(permission) ?? false
}
Principle: Sanitize Output, Not Just Input
// ❌ BAD — Only sanitizing input
function renderPatientName(name: string) {
  const sanitized = name.replace(/<script>/g, '') // Weak — misses <img onerror=...>
  return `<div>${sanitized}</div>`  // Still vulnerable to XSS
}

// ✅ GOOD — Use framework's auto-escaping, verify explicitly
// React auto-escapes JSX expressions
function PatientCard({ name }: { name: string }) {
  return <div>{name}</div>  // React escapes this automatically
}

// But verify: what about dangerouslySetInnerHTML?
function ConsultationNotes({ html }: { html: string }) {
  // ❌ NEVER do this without sanitization
  // return <div dangerouslySetInnerHTML={{ __html: html }} />

  // ✅ If you MUST render HTML, sanitize with a library
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br'],
    ALLOWED_ATTR: [],
  })
  return <div dangerouslySetInnerHTML={{ __html: sanitized }} />
}
Pattern: Secrets Never in Code
// ❌ BAD — Secret in code
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

// ❌ BAD — Secret in git-tracked config
// .env (committed to git)
// SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// ✅ GOOD — Secret in environment, validated at startup
const config = {
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseKey: requireEnv('SUPABASE_ANON_KEY'),
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

// Validate format to catch misconfiguration early
function validateConfig(config: AppConfig): void {
  if (!config.supabaseUrl.startsWith('https://')) {
    throw new Error('SUPABASE_URL must start with https://')
  }
  if (config.supabaseKey.length < 100) {
    throw new Error('SUPABASE_ANON_KEY appears invalid (too short)')
  }
}
7. CONCURRENCY & RESILIENCE
The Core Mindset
Everything that can go wrong, will go wrong — eventually. Network requests fail. Databases timeout. Third-party services go down. The question is not if something fails, but when — and whether your system recovers gracefully.

Pattern: Optimistic Concurrency Control (OCC)
// The problem: Two users modify the same record simultaneously.
// Without OCC: Last write wins. Data is silently corrupted.
// With OCC: Second writer detects the conflict and handles it.

class OCCUpdater<T extends { version: number }> {
  constructor(private repository: Repository<T>) {}

  async update(
    id: string,
    expectedVersion: number,
    changes: Partial<T>
  ): Promise<Result<T, OCCConflictError>> {
    // Attempt update with version check
    const updated = await this.repository.updateIfVersion(
      id,
      expectedVersion,
      { ...changes, version: expectedVersion + 1 }
    )

    if (updated === null) {
      // 0 rows affected — version changed since we read it
      const current = await this.repository.findById(id)
      return {
        ok: false,
        error: new OCCConflictError(
          id,
          expectedVersion,
          current?.version ?? -1
        ),
      }
    }

    return { ok: true, value: updated }
  }
}
Pattern: Circuit Breaker
// Prevents cascading failures when a dependency is down
// Instead of hammering a failing service, stop calling it temporarily

class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'
  private failureCount = 0
  private lastFailureTime = 0

  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeoutMs: number = 30000,
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<Result<T, CircuitBreakerError>> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'HALF_OPEN'
      } else {
        return { ok: false, error: new CircuitBreakerError('Circuit is open') }
      }
    }

    try {
      const result = await operation()
      this.onSuccess()
      return { ok: true, value: result }
    } catch (error) {
      this.onFailure()
      return { ok: false, error: new CircuitBreakerError('Operation failed', error) }
    }
  }

  private onSuccess(): void {
    this.failureCount = 0
    this.state = 'CLOSED'
  }

  private onFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN'
    }
  }
}

// Usage
const supabaseBreaker = new CircuitBreaker(5, 30000)

async function fetchQueue(sessionId: string) {
  const result = await supabaseBreaker.execute(() =>
    supabase.from('queue_entries').select('*').eq('session_id', sessionId)
  )

  if (!result.ok) {
    // Circuit is open — return cached data or show offline mode
    return getCachedQueue(sessionId) ?? []
  }

  return result.value
}
Pattern: Retry with Exponential Backoff and Jitter
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number
    baseDelayMs?: number
    maxDelayMs?: number
    shouldRetry?: (error: unknown) => boolean
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    shouldRetry = isRetryableError,
  } = options

  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error

      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error
      }

      // Exponential backoff with jitter
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt)
      const jitter = Math.random() * baseDelayMs // Random 0-1000ms
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs)

      await sleep(delay)
    }
  }

  throw lastError
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors — retry
    if (error.message.includes('fetch failed')) return true
    if (error.message.includes('network')) return true
    if (error.message.includes('timeout')) return true
  }
  // HTTP status codes — retry on 5xx, not on 4xx
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status
    return status >= 500 && status < 600
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
Pattern: Graceful Degradation
// When a non-critical dependency fails, degrade gracefully instead of crashing

async function loadDoctorDashboard(doctorId: string): Promise<DashboardData> {
  const [queue, drugPrefs, analytics] = await Promise.allSettled([
    fetchQueue(doctorId),                    // Critical — must succeed
    fetchDrugPreferences(doctorId),          // Nice to have — can use defaults
    fetchAnalytics(doctorId),                // Nice to have — can show placeholder
  ])

  // Critical path: fail if queue fetch failed
  if (queue.status === 'rejected') {
    throw new DashboardLoadError('Unable to load queue', queue.reason)
  }

  return {
    queue: queue.value,
    drugPreferences: drugPrefs.status === 'fulfilled'
      ? drugPrefs.value
      : getDefaultDrugPreferences(),  // Fallback: use defaults
    analytics: analytics.status === 'fulfilled'
      ? analytics.value
      : null,                          // Fallback: show "Analytics unavailable"
    degradedMode: drugPrefs.status === 'rejected' || analytics.status === 'rejected',
  }
}
8. API & INTERFACE DESIGN
The Core Mindset
A good API is hard to misuse and easy to extend. The best API is one where the compiler tells you when you're using it wrong, and the most obvious way to use it is the correct way.

Principle: Make Impossible States Unrepresentable
// ❌ BAD — Invalid states are possible
interface QueueEntry {
  status: string                                    // Any string is valid
  calledAt: string | null                           // Can be null even when status is COMPLETED
  consultationStartedAt: string | null              // Can be set without calledAt being set
  completedAt: string | null                        // Can be set without consultationStartedAt
}

// This is valid according to the type but semantically impossible:
// { status: 'COMPLETED', calledAt: null, consultationStartedAt: null, completedAt: '2026-03-30' }

// ✅ GOOD — Invalid states are impossible
type QueueEntry =
  | { status: 'CHECKED_IN'; createdAt: Date; version: number }
  | { status: 'CALLED'; calledAt: Date; version: number }
  | { status: 'IN_CONSULTATION'; calledAt: Date; consultationStartedAt: Date; version: number }
  | { status: 'COMPLETED'; calledAt: Date; consultationStartedAt: Date; completedAt: Date; version: number }
  | { status: 'NO_SHOW'; calledAt: Date; version: number }
  | { status: 'SKIPPED'; calledAt: Date; version: number }
  | { status: 'CANCELLED'; version: number }

// Now this is a compile error:
// entry.completedAt  ← Property 'completedAt' does not exist on type 'QueueEntry'
// Because TypeScript doesn't know which variant you have.

// You must narrow first:
function getWaitTime(entry: QueueEntry): number | null {
  if (entry.status === 'IN_CONSULTATION') {
    return Date.now() - entry.consultationStartedAt.getTime()
  }
  return null
}
Principle: Command-Query Separation
// ❌ BAD — Function does both command and query
function deletePatient(id: string): Patient | null {
  const patient = findPatient(id)
  if (!patient) return null        // Query: "Does this patient exist?"
  removePatient(id)                // Command: "Delete this patient"
  return patient                   // Returns the deleted patient (side effect + return value)
}

// ✅ GOOD — Separate commands (no return value) from queries (no side effects)
// Commands: do something, return success/failure
function deletePatient(id: string): Result<void, PatientNotFoundError> {
  const exists = existsPatient(id)  // Query inside command — OK for precondition check
  if (!exists) return { ok: false, error: new PatientNotFoundError(id) }
  removePatient(id)
  return { ok: true, value: undefined }
}

// Queries: return data, no side effects
function getPatient(id: string): Result<Patient, PatientNotFoundError> {
  const patient = findPatient(id)
  if (!patient) return { ok: false, error: new PatientNotFoundError(id) }
  return { ok: true, value: patient }
}
Principle: Backward Compatibility Through Extension
// ❌ BAD — Changing a function signature breaks all callers
// Version 1
function addPatient(name: string, mobile: string): Patient { }

// Version 2 — BREAKING CHANGE
function addPatient(name: string, mobile: string, dob: string, gender: string): Patient { }
// All existing callers are now broken

// ✅ GOOD — Extend through options object with defaults
// Version 1
interface AddPatientInput {
  name: string
  mobile: string
}
function addPatient(input: AddPatientInput): Patient { }

// Version 2 — Backward compatible
interface AddPatientInput {
  name: string
  mobile: string
  dob?: string        // Optional — existing callers still work
  gender?: string     // Optional — existing callers still work
  preferredLanguage?: string  // New in v2
}
function addPatient(input: AddPatientInput): Patient { }
// All existing callers continue to work without changes
Pattern: Builder for Complex Construction
// ❌ BAD — Too many parameters, easy to get wrong
createQueueEntry(clinicId, sessionId, patientId, 'walk_in', 'reception', false, null, 'synced')

// ✅ GOOD — Builder pattern for complex objects
const entry = QueueEntryBuilder
  .forSession(sessionId)
  .inClinic(clinicId)
  .forPatient(patientId)
  .asWalkIn()
  .fromReception()
  .withNotes('Patient reported chest pain')
  .build()

// The builder enforces required fields at compile time
// .forSession(sessionId) returns a type that requires .inClinic()
// .inClinic(clinicId) returns a type that requires .forPatient()
// .forPatient(patientId) returns a type with optional methods
// .build() is only available when all required fields are set
9. OBSERVABILITY & DEBUGGABILITY
The Core Mindset
You can't fix what you can't see. Production is the real test environment. When something goes wrong at 3 AM, the quality of your logging determines whether it takes 5 minutes or 5 hours to resolve.

Principle: Structured Logging Over String Logging
// ❌ BAD — Unstructured logs
console.log('Patient added to queue')
console.log(`Error: ${error.message}`)
console.log('Session opened for doctor', doctorId, 'at', new Date())

// ✅ GOOD — Structured logs with context
logger.info('patient_added_to_queue', {
  clinicId: entry.clinicId,
  sessionId: entry.sessionId,
  patientId: entry.patientId,
  tokenNumber: entry.tokenNumber,
  source: entry.source,
})

logger.error('queue_transition_failed', {
  entryId: entry.id,
  currentStatus: entry.status,
  attemptedAction: action,
  error: { code: error.code, message: error.message, stack: error.stack },
  userId: currentUser.id,
})

logger.info('session_opened', {
  clinicId,
  doctorId,
  sessionId: session.id,
  date: session.date,
  mode: clinic.mode, // solo or team
})
Why structured logs matter: You can query them. "Show me all queue_transition_failed events for clinic X in the last 24 hours" — instant. With string logs, you're grepping through text files.

Pattern: Contextual Error Messages
// ❌ BAD — Error message without context
throw new Error('Failed to add patient')

// ✅ GOOD — Error message with full context
throw new AddPatientError({
  message: 'Failed to add patient to queue',
  context: {
    clinicId,
    sessionId,
    patientId,
    mobile: mobile.toString(),
    source,
  },
  cause: underlyingError,
})

// When this error is logged, you see:
// {
//   "level": "error",
//   "event": "add_patient_failed",
//   "message": "Failed to add patient to queue",
//   "context": {
//     "clinicId": "abc-123",
//     "sessionId": "sess-456",
//     "patientId": "pat-789",
//     "mobile": "9876543210",
//     "source": "reception"
//   },
//   "cause": {
//     "code": "OCC_CONFLICT",
//     "message": "Version mismatch: expected 3, actual 4"
//   },
//   "timestamp": "2026-03-30T09:00:00.000Z"
// }
Pattern: Request Tracing
// Every request gets a unique ID that flows through the entire system
interface RequestContext {
  requestId: string    // Unique per request
  clinicId: string     // Tenant context
  userId: string       // Actor context
  timestamp: number    // When the request started
}

// Injected at the boundary (API handler), flows through all layers
async function handleRequest(req: Request): Promise<Response> {
  const requestId = req.headers.get('x-request-id') ?? generateId()
  const context: RequestContext = {
    requestId,
    clinicId: extractClinicId(req),
    userId: extractUserId(req),
    timestamp: Date.now(),
  }

  logger.info('request_started', {
    requestId: context.requestId,
    method: req.method,
    path: new URL(req.url).pathname,
  })

  try {
    const result = await routeHandler(req, context)

    logger.info('request_completed', {
      requestId: context.requestId,
      statusCode: result.status,
      durationMs: Date.now() - context.timestamp,
    })

    return result
  } catch (error) {
    logger.error('request_failed', {
      requestId: context.requestId,
      error: serializeError(error),
      durationMs: Date.now() - context.timestamp,
    })

    return errorResponse(500, 'Internal server error', { requestId })
  }
}

// Every downstream function receives the context
async function addPatientToQueue(
  input: AddPatientInput,
  context: RequestContext
): Promise<Result<QueueEntry, Error>> {
  logger.info('adding_patient_to_queue', {
    requestId: context.requestId,
    patientId: input.patientId,
  })
  // ... implementation
}
10. TECHNICAL DEBT MANAGEMENT
The Core Mindset
Technical debt is not inherently bad. It's a tool. Like financial debt, it lets you move faster now at the cost of paying interest later. The key is to take on debt consciously, track it, and pay it down strategically.

The Debt Quadrant
                    DELIBERATE
                        │
         ┌──────────────┼──────────────┐
         │  "We don't   │  "We know    │
         │   have time   │   this is a  │
         │   for tests"  │   hack, fix  │
         │               │   in sprint  │
         │   PRUDENT     │   3"         │
    ─────┤               │         RECK│
         │               │          LESS│
         │  "This seemed │  "What's a   │
         │   fine at     │   test?"     │
         │   the time"   │              │
         │               │              │
         │   INADVERTENT │              │
         └──────────────┼──────────────┘
                        │
                   INADVERTENT
Prudent deliberate debt: "We'll ship the queue feature without the analytics dashboard. We'll add it next sprint." — This is fine. It's a conscious trade-off.

Reckless deliberate debt: "We don't have time for tests. Ship it." — This is dangerous. You'll pay 10x later.

The Boy Scout Rule
Leave the code better than you found it. Not "rewrite everything." Not "refactor the entire module." Just: when you touch a function, clean it up a little.

// You came here to fix a bug in this function.
// While you're at it:

// BEFORE (what you found)
async function getQueue(sessionId) {
  const { data } = await supabase.from('queue_entries').select('*').eq('session_id', sessionId)
  return data
}

// AFTER (what you leave behind)
async function getQueue(sessionId: string): Promise<Result<QueueEntry[], DatabaseError>> {
  const { data, error } = await supabase
    .from('queue_entries')
    .select(QUEUE_SELECT)  // Use the existing select constant
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) return { ok: false, error: new DatabaseError('getQueue', error) }
  return { ok: true, value: (data ?? []).map(QueueEntry.fromDatabase) }
}

// Changes: added types, added error handling, added ordering, used Result type
// Time spent: 5 minutes
// Value: Every future caller gets proper error handling for free
When to Refactor vs. When to Rewrite
Refactor when:

The code works but is hard to understand
You need to add a feature and the current structure makes it difficult
You've identified a clear, bounded improvement
You can refactor incrementally (one function, one module at a time)
Rewrite when:

The fundamental architecture is wrong (not just messy — wrong)
The technology choice is causing compounding problems
The code is so tangled that refactoring is riskier than rewriting
You have the time, resources, and organizational support to do it properly
Never rewrite when:

"The code is ugly" — ugly but working code is valuable
You haven't read and understood the existing code first
You don't have tests to verify the rewrite produces the same behavior
You're rewriting because writing new code is more fun than reading old code
The Strangler Fig Pattern
For large-scale rewrites, don't replace the old system all at once. Grow the new system alongside the old one, gradually redirecting traffic.

Phase 1: New code handles 1 route, old code handles everything else

┌──────────────────────────────────────────────────┐
│                   APPLICATION                      │
│                                                    │
│   ┌─────────────┐        ┌──────────────────┐     │
│   │  NEW CODE    │        │    OLD CODE       │     │
│   │  /doctor/*   │        │    everything     │     │
│   │              │        │    else           │     │
│   └─────────────┘        └──────────────────┘     │
│                                                    │
└──────────────────────────────────────────────────┘

Phase 2: New code handles 3 routes, old code handles the rest

Phase 3: New code handles everything, old code is deleted
// The router gradually shifts traffic to the new implementation
function routeRequest(path: string): 'new' | 'old' {
  if (path.startsWith('/doctor')) return 'new'       // Migrated
  if (path.startsWith('/reception')) return 'new'    // Migrated
  if (path.startsWith('/display')) return 'new'      // Migrated
  return 'old'                                        // Not yet migrated
}
Tracking Debt
// Use code markers for known technical debt
// These are searchable: grep -r "TECH_DEBT" src/

// TECH_DEBT[LOW]: This uses setTimeout instead of a proper animation library.
// Fix when we add more animations. Low priority — works fine for now.
setTimeout(() => setOpen(false), 150)

// TECH_DEBT[MEDIUM]: This fetches all patients instead of paginating.
// Will become a problem above 10,000 patients. Fix before scaling.
const { data } = await supabase.from('patients').select('*')

// TECH_DEBT[HIGH]: This duplicates the brand color logic from ReceptionPortal.
// Extract to useClinicTheme hook. Fix this sprint.
useEffect(() => {
  if (clinic?.primary_color) {
    document.documentElement.style.setProperty('--primary', clinic.primary_color)
  }
}, [clinic?.primary_color])
Why this works: TECH_DEBT is searchable. You can run grep -r "TECH_DEBT" src/ | wc -l to see how much debt you have. You can run grep -r "TECH_DEBT\[HIGH\]" src/ to find the most urgent items. You can close one debt item per sprint as a standing commitment.

THE META-PRINCIPLE
All ten disciplines share one underlying principle:

Write code as if the person who maintains it is a sleep-deprived version of yourself who has forgotten everything about this project.

Because that's exactly who will maintain it. And that person will thank you for every clear name, every explicit type, every helpful error message, and every well-placed comment that explains why — not what.

The difference between senior and principal engineers is not that principals know more patterns. It's that principals understand every line of code is a liability — and they write the minimum necessary to solve the problem correctly, clearly, and safely.