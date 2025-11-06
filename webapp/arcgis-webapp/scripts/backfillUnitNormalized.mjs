#!/usr/bin/env node

/**
 * Populates the unit_normalized column on the listings table by reusing the same
 * unit-normalisation logic as the client. Run with --apply to persist updates.
 */

import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;
const UPSERT_CHUNK_SIZE = 500;

function parseArgs(argv) {
  const options = {
    apply: false,
  };

  argv.forEach((arg) => {
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.warn(`Ignoring unknown argument: ${arg}`);
    }
  });

  return options;
}

function printUsage() {
  console.log(`Usage: node webapp/arcgis-webapp/scripts/backfillUnitNormalized.mjs [--apply]

Options:
  --apply    Persist updates (omit for a dry-run preview)
  --help     Show this message`);
}

function normaliseUnit(value) {
  if (typeof value !== 'string') {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  }
  return value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

async function fetchAllListings(client) {
  const rows = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .from('listings')
      .select('id, unit, unit_normalized')
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch listings: ${error.message}`);
    }

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  return rows;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY.');
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log('Fetching listings...');
  const listings = await fetchAllListings(client);
  console.log(`Fetched ${listings.length.toLocaleString()} listing(s).`);

  const updates = [];
  listings.forEach((row) => {
    const normalized = normaliseUnit(row.unit ?? '');
    const stored = typeof row.unit_normalized === 'string' ? row.unit_normalized : '';
    if (normalized === stored) {
      return;
    }
    updates.push({
      id: row.id,
      unit_normalized: normalized || null,
    });
  });

  if (updates.length === 0) {
    console.log('All listings already have up-to-date unit_normalized values.');
    return;
  }

  console.log(
    `${updates.length.toLocaleString()} listing(s) require unit_normalized updates.`,
  );

  if (!options.apply) {
    console.log('Dry run complete. Re-run with --apply to persist changes.');
    return;
  }

  console.log('Applying updates...');
  for (let index = 0; index < updates.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = updates.slice(index, index + UPSERT_CHUNK_SIZE);
    const { error } = await client
      .from('listings')
      .upsert(chunk, { onConflict: 'id' });
    if (error) {
      throw new Error(`Failed to upsert chunk starting at index ${index}: ${error.message}`);
    }
  }

  console.log('unit_normalized values updated successfully.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
