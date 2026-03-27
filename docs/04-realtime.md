# Realtime Sync & OCC — V1

Supabase Realtime taps PostgreSQL WAL. You write to the database.
The database pushes to all subscribed clients automatically.
You never push events manually.

---

## How It Works

1. Any portal writes a queue status change
2. PostgreSQL executes the UPDATE, BEFORE trigger sets timestamps
3. WAL records the change
4. Supabase Realtime broadcasts JSON event over WebSocket to all subscribers
5. All portals receive the change within 100–200ms on local network

---

## Tables with Realtime Enabled

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE queue_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE queue_display_sync;
-- Do NOT add: patients, audit_logs, payments, staff
```

---

## OCC Helper — src/lib/occ.ts

```typescript
import { supabase } from './supabase';

type QueueStatus =
  | 'CHECKED_IN' | 'CALLED' | 'IN_CONSULTATION'
  | 'COMPLETED'  | 'NO_SHOW' | 'SKIPPED' | 'CANCELLED';

interface OCCResult {
  success: boolean;
  reason?: 'conflict' | 'error';
  data?: Record<string, unknown>;
}

export async function updateQueueStatus(
  id: string,
  currentVersion: number,
  newStatus: QueueStatus
): Promise<OCCResult> {
  // Client sends ONLY status + version — DB trigger sets all timestamps
  const { data, error } = await supabase
    .from('queue_entries')
    .update({ status: newStatus, version: currentVersion + 1 })
    .eq('id', id)
    .eq('version', currentVersion)
    .select()
    .single();

  if (error && error.code !== 'PGRST116') {
    return { success: false, reason: 'error' };
  }
  if (!data) {
    // rows_affected = 0 → OCC conflict
    return { success: false, reason: 'conflict' };
  }
  return { success: true, data };
}
```

**Rules:**
- Never send timestamp fields in the update payload — DB trigger handles them
- Always use `RETURNING *` (via `.select()`) — gets trigger-set timestamps back instantly
- `rows_affected = 0` = conflict → caller re-fetches and re-renders silently
- Never show a conflict error to the user

---

## Subscription Patterns

### Reception Portal

```typescript
// src/hooks/useQueue.ts
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useQueueRealtime(sessionId: string, onUpdate: (payload: unknown) => void) {
  useEffect(() => {
    const channel = supabase
      .channel(`queue-${sessionId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'queue_entries',
        filter: `session_id=eq.${sessionId}`,
      }, onUpdate)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);
}
```

### Doctor Portal

Same pattern as reception — filtered to doctor's own session_id only.
Doctor sees ONLY their session. session_id filter enforces this.

### Session Status Changes

```typescript
export function useSessionRealtime(onUpdate: (payload: unknown) => void) {
  useEffect(() => {
    const channel = supabase
      .channel('sessions-watch')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'sessions',
      }, onUpdate)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);
}
```

### TV Display

```typescript
// TV display subscribes to queue_display_sync — never raw queue_entries
// Uses scoped JWT with role: display — never anon key
export function useDisplayRealtime(sessionId: string, onUpdate: (payload: unknown) => void) {
  useEffect(() => {
    const channel = supabase
      .channel(`display-${sessionId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'queue_display_sync',
        filter: `session_id=eq.${sessionId}`,
      }, onUpdate)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);
}
```

---

## Portal Subscription Summary

| Portal | Table | Filter | Events | Auth |
|---|---|---|---|---|
| Reception | queue_entries | session_id=eq.X | INSERT, UPDATE | Staff JWT |
| Reception | sessions | (clinic RLS) | UPDATE | Staff JWT |
| Doctor | queue_entries | session_id=eq.X | INSERT, UPDATE | Staff JWT |
| TV Display | queue_display_sync | session_id=eq.X | UPDATE | Display JWT |

**Rules:**
- Max 2 active channels per portal at any time
- Always unsubscribe on component unmount — memory and connection leak otherwise
- Never subscribe to full table without filter — unnecessary event volume
- TV display never touches raw queue_entries — zero PII possible in broadcast

---

## Conflict Resolution Detail

1. Doctor reads entry: id=X, version=5
2. Reception reads same entry: id=X, version=5
3. Doctor sends: `UPDATE ... WHERE id=X AND version=5` → success → version=6
4. Realtime broadcasts UPDATE to all clients immediately
5. Reception sends: `UPDATE ... WHERE id=X AND version=5` → 0 rows affected
6. Reception detects conflict (no data returned) → re-fetches → re-renders
7. No error shown. UI updates to correct state automatically.

---

## Connection Status Monitoring

```typescript
// src/hooks/useConnectionStatus.ts
import { useEffect, useState } from 'react';

export function useConnectionStatus() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline  = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
```

When `online = false`:
- Show permanent banner: "Connection lost. Queue paused to prevent data conflicts."
- Disable all mutation buttons (Call, Complete, Skip, etc.)
- Doctor can still READ current patient profile on screen
- Re-enable buttons when connection restored
- Do NOT allow offline writes — OCC requires round-trip to DB to verify version
