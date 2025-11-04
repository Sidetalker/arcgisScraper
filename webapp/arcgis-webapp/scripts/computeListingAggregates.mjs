import { createClient } from '@supabase/supabase-js';
import { refreshListingAggregates } from './listingAggregateJob.mjs';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_PROJECT_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_KEY;

if (!SUPABASE_URL) {
  console.error('Missing Supabase URL. Provide SUPABASE_URL (or VITE_/NEXT_PUBLIC_ variants).');
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase service role key. Provide SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function main() {
  const result = await refreshListingAggregates(supabase, { logger: console });
  console.info('[metrics] Aggregates refreshed successfully.');
  console.info(
    `Processed ${result.listingsProcessed.toLocaleString()} listings → ${result.subdivisionsWritten} subdivisions, ${result.renewalTimelineBuckets} timeline buckets, ${result.renewalSummaryBuckets} summary buckets, ${result.renewalMethodBuckets} method buckets.`,
  );
}

main().catch((error) => {
  console.error('[metrics] Failed to refresh aggregates:', error);
  process.exitCode = 1;
});
