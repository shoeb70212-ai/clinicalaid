# Patient Profile UI — V1

---

## Desktop / Tablet Layout (Three Columns)

```
┌──────────────────┬──────────────────────────────┬─────────────────────┐
│ CONTEXT ANCHOR   │  ACTIVE CONSULTATION          │  NMC LEDGER         │
│ (20% width)      │  (50% width)                  │  (30% width)        │
├──────────────────┼──────────────────────────────┼─────────────────────┤
│ ⚠️ UNVERIFIED    │  Chief Complaint:             │  [▼] 12-Jan-2026    │
│ (amber banner)   │  [ Free text area... ]        │  Viral Fever        │
│                  │                               │  [ Repeat Rx ]      │
│ Rahul Sharma     │  Quick Notes:                 │                     │
│ 45M • A-07       │  [ Free text area... ]        │  [▶] 05-Nov-2025    │
│ Mob: 9876543210  │                               │  Asthma Follow-up   │
│                  │  Drug suggestion chips:       │                     │
│ 🔴 Penicillin    │  Usually prescribed with:     │  [▶] 10-Aug-2025    │
│ 🔴 Asthma        │  [Pantoprazole 40mg] [Econorm]│  Routine Checkup    │
│                  │                               │                     │
│ BP:  [  ]/[  ]   │                               │                     │
│ Temp:[    ] °F   │                               │                     │
│ SpO2:[    ] %    │                               │                     │
│ Pulse:[   ]      │                               │                     │
├──────────────────┼──────────────────────────────┼─────────────────────┤
│ [Confirm ID]     │ [Skip/Hold]  [Mark Complete]  │ [View Full History] │
└──────────────────┴──────────────────────────────┴─────────────────────┘
```

---

## Column 1: Context Anchor (always visible, never scrolls)

**Identity header:**
- Name, Age (auto-calculated from DOB), Gender, Token number
- Mobile number (for reference only — not editable here)
- DPDP consent badge: green tick = valid consent. Red = withdrawn/expired.

**Amber alert block (when identity_verified = FALSE):**
- Covers entire column 1 header in amber background
- Shows: Age, Gender, Last visit date (demographic cross-check anchors)
- Two buttons: [✓ Confirm Identity] and [⚠ Mismatch]
- All Column 2 inputs remain `disabled={true}` until identity confirmed

**Danger zone (red text — always visible):**
- Known allergies
- Chronic conditions
- Blood group

**Vitals input grid:**
- BP Systolic / Diastolic
- Temperature (°F)
- SpO2 (%)
- Pulse
- Weight (kg) — optional

These save to `queue_entries.notes` in V1 as structured text.
V2: dedicated vitals columns on `visits` table.

---

## Column 2: Active Encounter (disabled until identity confirmed)

**Chief Complaint:** auto-expanding text area. No character limit.

**Quick Notes:** free text. Saved to `queue_entries.notes`.
Note: this is NOT a medical record in V1. It is a scratchpad.
V2 moves this to the `visits` table with full structure.

**Drug suggestion chips (read-only — doctor must tap to accept):**
- "Usually prescribed with: [chip] [chip]" — Apriori associations
- Rendered below active drug entry
- Tapping chip opens drug detail, doctor confirms — never auto-adds

**Pre-filled dosage (soft blue highlight):**
- When doctor selects a drug, dosage/duration/timing pre-fills from their historical mode
- Highlighted in soft blue: `bg-blue-50 border-blue-200`
- Doctor must click [+ Add to Rx] to confirm — pre-fill is a suggestion, not a save

**Action footer (sticky at column bottom):**
- [Skip / Hold] → SKIPPED transition
- [No Show] → NO_SHOW transition
- [Mark Complete] → COMPLETED transition (triggers Z-Report update)

---

## Column 3: NMC Ledger (historical visits — right sidebar)

**Visit timeline:** vertically scrollable list of past queue entries + notes.

Each card shows:
- Date
- Primary complaint (from notes)
- [▶ Expand] to see full notes from that visit

**Repeat Rx button:**
- Appears on each historical card
- [Copy to Current Notes] — copies previous quick notes as starting template
- Doctor edits as needed — never auto-populates the active encounter directly

V2: this column shows full structured visit history from the `visits` table.

---

## Mobile Layout (Tabbed — keyboard-safe)

```
┌─────────────────────────────────┐
│ ← Queue              Token A-07 │
├─────────────────────────────────┤
│ ⚠️ UNVERIFIED — Tap to verify   │
│ Rahul Sharma  45M               │
│ [✓ Confirm]     [⚠ Mismatch]    │
├─────────────────────────────────┤
│ 🔴 Penicillin   🔴 Asthma       │
├─────────────────────────────────┤
│                                 │
│  [Active tab content renders]   │
│  (scrollable, keyboard-aware)   │
│                                 │
│                                 │
├─────────────────────────────────┤
│  [Mark Complete — full width]   │
├─────────────────────────────────┤
│  [📝 Notes]  [🕒 History]  [👤 Vitals] │
└─────────────────────────────────┘
```

**Sticky top header:** identity, amber alert, danger pills — never scrolls away
**Tabbed body:** Notes / History / Vitals — only one renders at a time
**Sticky bottom:** [Mark Complete] button + tab navigation
**Keyboard behaviour:** when keyboard opens, sticky bottom stays above it

---

## UI Rules

### No modals on consultation screen
Everything inline. If doctor opens a modal to add a drug, they lose sight of allergies.
No modal on the active consultation. Zero exceptions.

### localStorage auto-save
On every keystroke in Chief Complaint or Quick Notes:
```typescript
localStorage.setItem(`draft-${queueEntryId}`, JSON.stringify(draftState));
```
On page load, check localStorage and rehydrate if draft exists for current entry.
Clear draft on [Mark Complete].
Prevents losing notes if browser crashes or tab is accidentally closed.

### Minimum tap targets
All buttons, chips, and interactive elements: minimum 48×48px.
Clinic staff use tablets and touchscreens — hover states are not sufficient.

### Allergy visibility rule
Allergy and chronic condition pills must be visible regardless of which tab is active.
They live in the sticky header — never inside a tab that can be scrolled away.

### Font minimums
- Body text: 16px minimum
- Queue numbers / token numbers: 28px minimum
- Allergy labels: 18px, bold, red — never de-emphasised

---

## Consent Status Display

| Consent State | Visual | Action Available |
|---|---|---|
| Valid + current version | 🟢 small green badge | None needed |
| Valid but older version | 🟡 amber badge "Update required" | Show new consent on next check-in |
| Withdrawn | 🔴 "Consent withdrawn" | Block check-in. Show withdrawal date. |
| Never given | 🔴 "No consent on record" | Show consent form before proceeding |

---

## V2 Additions to This Screen

When V2 is built, the following are added to Column 2:
- ICD-10 diagnosis code autocomplete
- Full drug Rx builder (not just quick notes)
- Vitals moved from notes to structured inputs linked to `visits` table
- Prescription finalisation button → generates PDF

Column 3 in V2 shows:
- Full structured visit history from `visits` table
- Previous prescriptions with [Repeat Rx] that populates the Rx builder
- Lab investigation results (if OCR or manual entry is built)
