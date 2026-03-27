import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnon) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Copy .env.example to .env.local and fill in your project values.'
  )
}

/**
 * Single Supabase client instance for the entire app.
 * All portals import from here — never create a second client.
 */
export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: true,
  },
})
