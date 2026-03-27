# OAuth Login Fix - Change Log

## Problem
Google OAuth login resulted in a redirect loop - after successful authentication, users were redirected back to login instead of the authenticated dashboard.

## Root Cause
The JWT enrichment edge function wasn't working reliably, and there were mismatches between where the hook wrote claims vs where the frontend read them.

## Changes Made

### 1. Backend: Migration for RLS Policy (supabase/migrations/005_staff_self_read.sql)
- Created new RLS policy allowing users to read their own staff record by user_id
- This enables AuthCallback to query staff table after OAuth login

### 2. Edge Function: JWT Enrichment (supabase/functions/jwt-enrichment/index.ts)
- Fixed to return claims at ROOT level (not wrapped in "claims" object)
- Supabase expects root-level JSON to merge into app_metadata
- Added logging for debugging

### 3. useAuth.tsx - Main Auth Hook
**Before:** Relied on JWT app_metadata for role, clinic_id, staff_id
**After:** Queries staff table directly using session.user.id
- Removed `is_active` filter from query (check manually after)
- Added detailed console logging
- Handles cases where staff record doesn't exist or is inactive
- Allows access to app even if staff query fails (for onboarding flow)

### 4. AuthCallback.tsx - OAuth Callback Handler
**Before:** Tried to read role from app_metadata
**After:** 
- Queries staff table directly using user's ID
- Added 500ms delay before checking session
- Routes based on actual staff record role
- Handles inactive staff (signs out, redirects to login)
- Added detailed console logging

### 5. LoginPage.tsx - Email/Password Login
**Before:** Filtered by is_active in query
**After:**
- Queries staff without is_active filter first
- Checks is_active manually after
- Shows proper error message for inactive accounts
- Routes based on role or to /setup

## Files Modified
1. `supabase/migrations/005_staff_self_read.sql` (new)
2. `supabase/functions/jwt-enrichment/index.ts`
3. `src/hooks/useAuth.tsx`
4. `src/components/shared/AuthCallback.tsx`
5. `src/components/shared/LoginPage.tsx`

## Debugging Notes
Check browser console for these logs:
- `[AuthCallback] routeBySession started, user: ...`
- `[AuthCallback] Staff query result: { hasData, error, role, isActive }`
- `[useAuth] loadProfile called, user id: ...`
- `[useAuth] Staff query result: { hasData, error, role, isActive }`

## Manual Steps Required
Run the migration in Supabase Dashboard → SQL Editor:
```sql
CREATE POLICY staff_self_read ON staff
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
```

## Test Flow
1. User clicks "Continue with Google"
2. Google OAuth completes → redirects to /auth/callback
3. AuthCallback queries staff table by user_id
4. If no staff record → routes to /setup (onboarding)
5. If staff record exists + active → routes to doctor/reception
6. If staff record exists + inactive → signs out, shows error