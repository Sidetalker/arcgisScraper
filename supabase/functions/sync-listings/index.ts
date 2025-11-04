import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { syncListingsFromArcgis } from '../../../webapp/arcgis-webapp/src/shared/listingSync.ts';
import { fetchStoredListings, replaceAllListings } from '../../../webapp/arcgis-webapp/src/services/listingStorage.ts';
import { insertListingSyncEvent } from '../../../webapp/arcgis-webapp/src/services/listingSyncEvents.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SYNC_SERVICE_TOKEN = Deno.env.get('SYNC_SERVICE_TOKEN');

if (!SUPABASE_URL) {
  console.error('Missing SUPABASE_URL environment variable.');
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
}

if (!SYNC_SERVICE_TOKEN) {
  console.warn('Missing SYNC_SERVICE_TOKEN environment variable. Automated sync endpoint will reject all requests.');
}

function isAuthorised(request: Request): boolean {
  const header = request.headers.get('authorization');
  if (!header || !SYNC_SERVICE_TOKEN) {
    return false;
  }
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') {
    return false;
  }
  return token?.trim() === SYNC_SERVICE_TOKEN;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { 'Allow': 'POST' },
    });
  }

  if (!isAuthorised(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('Supabase credentials not configured', { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    const result = await syncListingsFromArcgis('scheduled', {
      loadSnapshot: () => fetchStoredListings(supabase),
      replaceAll: (records) => replaceAllListings(records, supabase),
      recordEvent: (input) => insertListingSyncEvent(input, supabase),
    });

    return new Response(
      JSON.stringify({
        status: 'ok',
        eventId: result.event.id,
        summary: {
          startedAt: result.summary.startedAt.toISOString(),
          completedAt: result.summary.completedAt.toISOString(),
          previousTotal: result.summary.previousTotal,
          currentTotal: result.summary.currentTotal,
          addedCount: result.summary.addedCount,
          removedCount: result.summary.removedCount,
          updatedCount: result.summary.updatedCount,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Automated ArcGIS sync failed.', error);
    const message = error instanceof Error ? error.message : 'Unknown sync error';
    return new Response(
      JSON.stringify({ status: 'error', message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
});
