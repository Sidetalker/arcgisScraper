import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ??
  import.meta.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  import.meta.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  console.warn('Supabase URL env variable is missing. Set VITE_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL, or SUPABASE_URL.');
}

if (!SUPABASE_ANON_KEY) {
  console.warn('Supabase anon key env variable is missing. Set VITE_SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_ANON_KEY.');
}

export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : undefined;

export function assertSupabaseClient() {
  if (!supabase) {
    throw new Error(
      'Supabase client is not initialised. Ensure one of VITE_/NEXT_PUBLIC_/SUPABASE_ URL and anon key env variables are set.',
    );
  }
  return supabase;
}
