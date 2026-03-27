# Offline Mode — V1

---

## Strategy: Hard Block with Graceful Read-Only

ClinicFlow V1 uses a Hard Block strategy for offline behaviour.
When the clinic's internet connection drops, all queue mutations are disabled.
The doctor can still read the current patient's profile on screen.

### Why not offline-first writes

OCC requires a round-trip to PostgreSQL to verify the version integer.
If writes are allowed offline, version integers diverge between local and remote.
On reconnect, every pending write fails OCC — data loss and queue corruption.

For a queue management system, physical reality matches the hard block:
if the internet is down, the queue does not synchronise across portals anyway.
The clinic falls back to calling patients verbally.

---

## Connection Detection

```typescript
// src/hooks/useConnectionStatus.ts
import { useEffect, useState } from 'react';

export function useConnectionStatus() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const setOn  = () => setOnline(true);
    const setOff = () => setOnline(false);

    window.addEventListener('online',  setOn);
    window.addEventListener('offline', setOff);

    return () => {
      window.removeEventListener('online',  setOn);
      window.removeEventListener('offline', setOff);
    };
  }, []);

  return online;
}
```

---

## UI Behaviour When Offline

```
┌─────────────────────────────────────────────────────────────┐
│ 🔴 Connection lost — queue paused to prevent data conflicts  │
│    You can still read the current patient's profile.         │
│    All action buttons will re-enable when connection returns. │
└─────────────────────────────────────────────────────────────┘
```

**When offline:**
- Permanent amber/red banner at top of all portals
- All mutation buttons disabled: Call, Complete, Skip, No Show, Cancel
- Doctor can still READ: current patient name, notes, quick notes field
- `localStorage` auto-save continues working (no network needed)
- Drug search falls back to local doctor_drug_prefs batch only (no master query)
- QR check-in page stops rendering (presence gate handles this automatically)

**When connection restores:**
- Banner disappears
- All buttons re-enable
- Supabase Realtime reconnects automatically
- UI re-fetches current queue state to catch up with any remote changes

---

## localStorage Auto-Save (session continuity)

Protects against browser crash, accidental tab close, or power cut mid-consultation.

```typescript
// src/lib/draftSave.ts

const DRAFT_KEY = (queueEntryId: string) => `clinicflow-draft-${queueEntryId}`;

export function saveDraft(queueEntryId: string, draft: ConsultationDraft) {
  try {
    localStorage.setItem(DRAFT_KEY(queueEntryId), JSON.stringify({
      ...draft,
      savedAt: Date.now(),
    }));
  } catch {
    // localStorage full — fail silently, do not crash consultation
  }
}

export function loadDraft(queueEntryId: string): ConsultationDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(queueEntryId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Discard drafts older than 24 hours
    if (Date.now() - parsed.savedAt > 86400000) {
      localStorage.removeItem(DRAFT_KEY(queueEntryId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(queueEntryId: string) {
  localStorage.removeItem(DRAFT_KEY(queueEntryId));
}
```

**Usage:**
- Save on every keystroke in Chief Complaint or Quick Notes (debounced 500ms)
- Load on consultation screen mount — check for draft and rehydrate if exists
- Show banner if draft restored: "Unsaved notes from previous session restored."
- Clear draft on successful [Mark Complete]

---

## Drug Batch (offline search)

Doctor's drug batch (`doctor_drug_prefs`) is already in Supabase — no extra local DB needed.
When offline, drug search queries Supabase fail gracefully.
Client shows only previously loaded batch results from React state / component memory.

> V2: Native wrapper uses SQLite (SQLCipher encrypted) for true offline drug batch storage.
> V1 PWA has no local DB — relies on in-memory state and Supabase connectivity.

---

## Sync Status Indicator

```typescript
// Permanent UI indicator — doctors must know if pending writes exist
// V1: All writes are synchronous (online-only) so indicator is simple

// Online:
// 🟢 small dot in header — "Live"

// Offline:
// 🔴 dot — "Offline"

// V2 (native wrapper with offline queue):
// 🟡 "Offline — 8 pending" — shows count of writes waiting to sync
```

---

## What Stays Available Offline

| Feature | Offline Available |
|---|---|
| Read current patient profile | ✅ Yes (loaded in memory) |
| Read queue list (stale) | ✅ Yes (last loaded state) |
| Drug search (batch only) | ✅ Yes (in-memory state) |
| Quick notes text area | ✅ Yes (localStorage saves) |
| Queue mutations (call, complete, skip) | ❌ No — hard blocked |
| Adding new patients | ❌ No — requires DB write |
| QR check-in | ❌ No — presence gate blocks |

---

## V2 Offline Architecture (native wrapper)

V2 uses Capacitor or Tauri to wrap the PWA as a native app.
Native apps get access to:

**SQLite (SQLCipher encrypted):**
- Full drug batch stored locally in encrypted SQLite
- Today's patients cached locally (rolling cache — wiped on successful sync)
- `sync_status = 'pending'` queue entries held locally

**Background sync on reconnect:**
- Native background execution API fires when device reconnects to WiFi
- Pending writes pushed to Supabase before user opens the app
- Merge strategy on reconnect: remote queue changes append below local completed entries

**DPDP compliance for local storage:**
- SQLCipher encryption: if device is stolen, local data is unreadable
- Rolling cache: only today's patients, wiped after successful sync
- Never cache the full patient database locally

**Sync status indicator in V2:**
- Permanent badge: 🟢 Live / 🔴 Offline — N pending
- Doctor must not switch devices if red indicator is showing
- "N pending" tells them exactly how many writes are waiting
