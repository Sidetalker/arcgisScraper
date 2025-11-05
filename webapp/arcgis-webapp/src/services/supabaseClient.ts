import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ??
  import.meta.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  import.meta.env.SUPABASE_ANON_KEY;

const NORMALISED_SUPABASE_URL = SUPABASE_URL?.replace(/\/+$/, '') ?? null;
const REST_RELOAD_ENDPOINT = NORMALISED_SUPABASE_URL
  ? `${NORMALISED_SUPABASE_URL}/rest/v1/?reload=true`
  : null;

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

export async function reloadSupabaseSchemaCache(): Promise<boolean> {
  if (!REST_RELOAD_ENDPOINT || !SUPABASE_ANON_KEY) {
    return false;
  }

  try {
    const response = await fetch(REST_RELOAD_ENDPOINT, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    return response.ok;
  } catch (error) {
    console.warn('Failed to reload Supabase schema cache.', error);
    return false;
  }
}
