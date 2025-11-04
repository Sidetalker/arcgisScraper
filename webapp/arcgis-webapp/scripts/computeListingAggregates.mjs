import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import { refreshListingAggregates } from './listingAggregateJob.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(SCRIPT_DIR, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const fileContents = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of fileContents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const sanitizedLine = line.startsWith('export ') ? line.slice('export '.length) : line;
    const separatorIndex = sanitizedLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = sanitizedLine.slice(0, separatorIndex).trim();
    let value = sanitizedLine.slice(separatorIndex + 1).trim();

    if (!key || key in process.env) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

for (const envFile of ['.env.local', '.env']) {
  loadEnvFile(path.join(WORKSPACE_ROOT, envFile));
}

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
  const landBaronsWritten =
    typeof result.landBaronsWritten === 'number' ? result.landBaronsWritten : 0;
  const zonesWritten = typeof result.zonesWritten === 'number' ? result.zonesWritten : 0;
  console.info(
    `Processed ${result.listingsProcessed.toLocaleString()} listings → ${result.subdivisionsWritten} subdivisions, ${zonesWritten} zones, ${landBaronsWritten} land barons, ${result.renewalTimelineBuckets} timeline buckets, ${result.renewalSummaryBuckets} summary buckets, ${result.renewalMethodBuckets} method buckets.`,
  );
}

main().catch((error) => {
  console.error('[metrics] Failed to refresh aggregates:', error);
  process.exitCode = 1;
});
