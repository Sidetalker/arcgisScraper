import { serve } from 'https://deno.land/std@0.210.0/http/server.ts';
import { createClient } from 'https://esm.sh/v135/@supabase/supabase-js@2.39.7?target=deno';
import { refreshListingAggregates } from '../../../webapp/arcgis-webapp/scripts/listingAggregateJob.mjs';

const SUPABASE_URL =
  Deno.env.get('SUPABASE_URL') ||
  Deno.env.get('VITE_SUPABASE_URL') ||
  Deno.env.get('NEXT_PUBLIC_SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  Deno.env.get('SUPABASE_SERVICE_KEY') ||
  Deno.env.get('SUPABASE_SECRET_KEY') ||
  Deno.env.get('SUPABASE_SERVICE_ROLE') ||
  Deno.env.get('SUPABASE_KEY');
const METRICS_REFRESH_TOKEN = Deno.env.get('METRICS_REFRESH_TOKEN');

function jsonResponse(body: Record<string, unknown>, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', message: 'Method not allowed' }, { status: 405 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[metrics] Supabase credentials missing in edge function environment.');
    return jsonResponse({ status: 'error', message: 'Supabase not configured' }, { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const providedToken = req.headers.get('x-metrics-refresh-token');
  const usingSecret = Boolean(
    METRICS_REFRESH_TOKEN && providedToken && providedToken === METRICS_REFRESH_TOKEN,
  );

  if (!usingSecret) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ status: 'error', message: 'Unauthorized' }, { status: 401 });
    }

    const accessToken = authHeader.replace('Bearer ', '').trim();
    if (!accessToken) {
      return jsonResponse({ status: 'error', message: 'Unauthorized' }, { status: 401 });
    }

    const { data: userResult, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userResult?.user) {
      return jsonResponse({ status: 'error', message: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await refreshListingAggregates(supabase, {
      logger: {
        info: (...args: unknown[]) => console.log('[metrics]', ...args),
        error: (...args: unknown[]) => console.error('[metrics]', ...args),
      },
    });

    return jsonResponse({ status: 'ok', result });
  } catch (error) {
    console.error('[metrics] Failed to refresh aggregates from edge function.', error);
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return jsonResponse({ status: 'error', message }, { status: 500 });
  }
});
