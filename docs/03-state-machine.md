# Queue State Machine — V1

Every queue entry moves through defined states.
Any transition not listed below is invalid — reject at TypeScript layer AND database level.

---

## The 7 States

| State | Meaning |
|---|---|
| CHECKED_IN | Patient is in queue. No action taken yet. |
| CALLED | Patient summoned to consultation room. |
| IN_CONSULTATION | Patient is with doctor. Clock running. |
| COMPLETED | Consultation done. Terminal state. |
| NO_SHOW | Called but did not appear. |
| SKIPPED | Asked to wait. Remains in queue, lower priority. |
| CANCELLED | Left before being called. Terminal state. |

---

## Valid Transitions

| From | To | Who Can Trigger | Notes |
|---|---|---|---|
| CHECKED_IN | CALLED | Doctor, Reception | Primary flow |
| CHECKED_IN | SKIPPED | Reception only | Patient asks to wait |
| CHECKED_IN | NO_SHOW | Reception only | Patient left undetected |
| CHECKED_IN | CANCELLED | Reception (V1), Kiosk (V2) | Patient leaves |
| CALLED | IN_CONSULTATION | Doctor only | `identity_verified` must be TRUE |
| CALLED | NO_SHOW | Doctor, Reception | Patient did not come |
| CALLED | SKIPPED | Reception only | Patient not ready |
| IN_CONSULTATION | COMPLETED | Doctor only | Ends consultation |
| SKIPPED | CHECKED_IN | Reception only | Patient returns to active queue |
| NO_SHOW | CHECKED_IN | Reception only | Patient returns same day |

---

## Terminal States — No Exit, Ever

- **COMPLETED** → cannot be reopened. No transition out.
- **CANCELLED** → cannot be reactivated. No transition out.

---

## Invalid Transitions — Reject Immediately

- COMPLETED → any state
- CANCELLED → any state
- IN_CONSULTATION → CHECKED_IN (cannot un-start a consultation)
- IN_CONSULTATION → CALLED
- Any transition not in the valid table above

---

## Identity Verification Gate

`identity_verified` must be TRUE before CALLED → IN_CONSULTATION is allowed.

This applies when `source = 'qr_kiosk'`.
When `source = 'reception'` or `source = 'doctor_rapid'`, `identity_verified` defaults to TRUE.

The doctor must click [Confirm Identity] or [Imposter] before the consultation can start.
If [Imposter] is clicked: queue entry unlinked from victim patient, new blank patient created.

---

## Queue Sort Order (never use mutable position column)

```sql
-- Always sort dynamically:
ORDER BY
  CASE status
    WHEN 'CALLED'      THEN 0
    WHEN 'CHECKED_IN'  THEN 1
    WHEN 'SKIPPED'     THEN 2
    ELSE 3
  END,
  created_at ASC;
```

The `position` column does NOT exist in V1 schema.
Dynamic sorting eliminates O(N) update cost on every skip/cancel.

---

## Wait Time Estimation

Displayed on queue panel as "Approx X minutes".

```
estimated_wait = patients_ahead × session.avg_consultation_seconds / 60
```

`session.avg_consultation_seconds` is updated automatically by DB trigger
on every COMPLETED transition (rolling average for the session).
Default: 300 seconds (5 minutes) until enough data exists.

---

## Role Authority Summary

| Actor | Permitted Transitions |
|---|---|
| Doctor portal | CHECKED_IN→CALLED, CALLED→IN_CONSULTATION, CALLED→NO_SHOW, IN_CONSULTATION→COMPLETED |
| Reception portal | CHECKED_IN→CALLED, CHECKED_IN→SKIPPED, CHECKED_IN→NO_SHOW, CHECKED_IN→CANCELLED, CALLED→NO_SHOW, CALLED→SKIPPED, SKIPPED→CHECKED_IN, NO_SHOW→CHECKED_IN |
| Display portal | Read-only. Zero mutations. Ever. |

---

## TypeScript Enforcement

```typescript
// src/lib/transitions.ts

type QueueStatus =
  | 'CHECKED_IN' | 'CALLED' | 'IN_CONSULTATION'
  | 'COMPLETED'  | 'NO_SHOW' | 'SKIPPED' | 'CANCELLED';

type StaffRole = 'doctor' | 'receptionist' | 'admin';

const VALID: Record<QueueStatus, Partial<Record<QueueStatus, StaffRole[]>>> = {
  CHECKED_IN: {
    CALLED:    ['doctor','receptionist','admin'],
    SKIPPED:   ['receptionist','admin'],
    NO_SHOW:   ['receptionist','admin'],
    CANCELLED: ['receptionist','admin'],
  },
  CALLED: {
    IN_CONSULTATION: ['doctor'],
    NO_SHOW:         ['doctor','receptionist','admin'],
    SKIPPED:         ['receptionist','admin'],
  },
  IN_CONSULTATION: {
    COMPLETED: ['doctor'],
  },
  SKIPPED:   { CHECKED_IN: ['receptionist','admin'] },
  NO_SHOW:   { CHECKED_IN: ['receptionist','admin'] },
  COMPLETED: {},   // terminal
  CANCELLED: {},   // terminal
};

export function isValidTransition(
  from: QueueStatus,
  to: QueueStatus,
  role: StaffRole,
  identityVerified: boolean
): boolean {
  if (to === 'IN_CONSULTATION' && !identityVerified) return false;
  const allowed = VALID[from]?.[to];
  if (!allowed) return false;
  return allowed.includes(role);
}
```

---

## Conflict Resolution

When doctor and reception both trigger CHECKED_IN → CALLED simultaneously:

1. Both reads see version = 5
2. Doctor write arrives first: `WHERE version = 5` → success → version becomes 6
3. Supabase Realtime broadcasts UPDATE to all clients
4. Reception write: `WHERE version = 5` → 0 rows affected → conflict
5. Reception re-fetches (version = 6, status = CALLED) → re-renders silently
6. No error shown. No data corruption.

Log conflict count to Sentry. High rate = UX issue (both portals showing same button).
