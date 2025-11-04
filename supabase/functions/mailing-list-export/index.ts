import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.0?target=deno';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5?target=deno&deno-std=0.207.0';

import { applyFilters, toListingRecord } from '../../../webapp/arcgis-webapp/shared/listingTransformer.ts';
import type {
  ArcgisFeature,
  ListingAttributes,
  ListingFilters,
  ListingRecord,
  MailingListExportJobPayload,
  MailingListExportStatus,
  RegionCircle,
} from '../../../webapp/arcgis-webapp/shared/types.ts';

interface MailingListExportRow {
  id: string;
  status: MailingListExportStatus;
  filters: ListingFilters;
  regions: RegionCircle[];
  file_paths: { csv?: string | null; xlsx?: string | null } | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface ListingRow {
  raw: ListingAttributes | null;
  latitude: number | null;
  longitude: number | null;
}

const EXPORT_BUCKET = 'mailing-exports';
const EXPORT_ROOT = 'jobs';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const rawAllowedOrigin =
  Deno.env.get('MAILING_LIST_ALLOWED_ORIGIN') ??
  Deno.env.get('MAILING_LIST_ALLOWED_ORIGINS') ??
  '*';
const ALLOWED_ORIGIN =
  rawAllowedOrigin
    .split(',')
    .map((value) => value.trim())
    .find((value) => value.length > 0) ?? '*';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

if (ALLOWED_ORIGIN !== '*') {
  corsHeaders.Vary = 'Origin';
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase service role configuration is required for mailing-list-export function.');
}

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function normaliseFilters(input: unknown): ListingFilters {
  const source = (typeof input === 'object' && input) || {};
  return {
    searchTerm: typeof (source as Record<string, unknown>).searchTerm === 'string'
      ? (source as Record<string, string>).searchTerm
      : '',
    complex: typeof (source as Record<string, unknown>).complex === 'string'
      ? (source as Record<string, string>).complex
      : '',
    owner: typeof (source as Record<string, unknown>).owner === 'string'
      ? (source as Record<string, string>).owner
      : '',
  };
}

function normaliseRegions(input: unknown): RegionCircle[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      const lat = typeof record.lat === 'number' ? record.lat : null;
      const lng = typeof record.lng === 'number' ? record.lng : null;
      const radius = typeof record.radius === 'number' ? record.radius : null;
      if (lat === null || lng === null || radius === null || !Number.isFinite(radius) || radius <= 0) {
        return null;
      }
      return { lat, lng, radius };
    })
    .filter((region): region is RegionCircle => Boolean(region));
}

function matchesRegions(listing: ListingRecord, regions: RegionCircle[]): boolean {
  if (!regions.length) {
    return true;
  }
  if (typeof listing.latitude !== 'number' || typeof listing.longitude !== 'number') {
    return false;
  }

  const EARTH_RADIUS_METERS = 6_371_000;
  const lat = listing.latitude;
  const lng = listing.longitude;

  return regions.some((region) => {
    const lat1 = (lat * Math.PI) / 180;
    const lat2 = (region.lat * Math.PI) / 180;
    const deltaLat = ((region.lat - lat) * Math.PI) / 180;
    const deltaLng = ((region.lng - lng) * Math.PI) / 180;
    const haversine =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const distance = 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
    return distance <= region.radius;
  });
}

function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          if (value === null || value === undefined) {
            return '';
          }
          const text = value.replace(/"/g, '""');
          return /["\n,]/.test(text) ? `"${text}"` : text;
        })
        .join(','),
    )
    .join('\n');
}

function toXlsxBuffer(rows: string[][]): Uint8Array {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Mailing List');
  const array = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Uint8Array(array);
}

function serialiseJob(row: MailingListExportRow, downloadUrls?: { csv?: string | null; xlsx?: string | null }): MailingListExportJobPayload {
  return {
    id: row.id,
    status: row.status,
    downloadUrls: downloadUrls ?? null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

async function fetchJob(jobId: string): Promise<MailingListExportRow | null> {
  const { data, error } = await serviceClient
    .from('mailing_list_exports')
    .select('id, status, filters, regions, file_paths, error, created_at, updated_at')
    .eq('id', jobId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw error;
  }

  if (!data) {
    return null;
  }

  const row = data as unknown as MailingListExportRow;
  row.filters = normaliseFilters(row.filters);
  row.regions = normaliseRegions(row.regions);
  row.file_paths = (typeof row.file_paths === 'object' && row.file_paths)
    ? (row.file_paths as { csv?: string | null; xlsx?: string | null })
    : null;
  return row;
}

async function updateJob(jobId: string, patch: Partial<MailingListExportRow>): Promise<void> {
  const payload = { ...patch, updated_at: new Date().toISOString() };
  const { error } = await serviceClient.from('mailing_list_exports').update(payload).eq('id', jobId);
  if (error) {
    throw error;
  }
}

async function createJob(filters: ListingFilters, regions: RegionCircle[]): Promise<MailingListExportRow> {
  const { data, error } = await serviceClient
    .from('mailing_list_exports')
    .insert({
      status: 'pending',
      filters,
      regions,
      error: null,
      file_paths: null,
    })
    .select('id, status, filters, regions, file_paths, error, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  const row = data as unknown as MailingListExportRow;
  row.filters = normaliseFilters(row.filters);
  row.regions = normaliseRegions(row.regions);
  row.file_paths = null;
  return row;
}

async function listRecords(): Promise<ListingRow[]> {
  const { data, error } = await serviceClient
    .from('listings')
    .select('raw, latitude, longitude');
  if (error) {
    throw error;
  }
  return (data ?? []) as unknown as ListingRow[];
}

async function processMailingListJob(job: MailingListExportRow): Promise<void> {
  try {
    await updateJob(job.id, { status: 'processing', error: null });

    const rows = await listRecords();
    const features: Array<ArcgisFeature<ListingAttributes>> = rows.map((row) => {
      const attributes = (row.raw ?? {}) as ListingAttributes;
      const geometry =
        typeof row.longitude === 'number' && typeof row.latitude === 'number'
          ? { x: row.longitude, y: row.latitude }
          : undefined;
      return { attributes, geometry };
    });

    const listings: ListingRecord[] = [];
    features.forEach((feature, index) => {
      const record = toListingRecord(feature, index);
      if (applyFilters(record, job.filters) && matchesRegions(record, job.regions)) {
        listings.push(record);
      }
    });

    const header = [
      'Owner name',
      'Mailing address line 1',
      'Mailing address line 2',
      'Mailing city',
      'Mailing state',
      'Mailing ZIP',
      'Complex',
      'Unit',
      'Schedule number',
      'Physical address',
      'Business owned',
    ];

    const rowsForExport = listings.map((listing) => [
      listing.ownerName,
      listing.mailingAddressLine1,
      listing.mailingAddressLine2,
      listing.mailingCity,
      listing.mailingState,
      listing.mailingZip9 || listing.mailingZip5,
      listing.complex,
      listing.unit,
      listing.scheduleNumber,
      listing.physicalAddress,
      listing.isBusinessOwner ? 'Yes' : 'No',
    ]);

    const exportRows = [header, ...rowsForExport];
    const csvContent = toCsv(exportRows);
    const xlsxContent = toXlsxBuffer(exportRows);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const basePath = `${EXPORT_ROOT}/${job.id}`;
    const csvPath = `${basePath}/mailing-list-${timestamp}.csv`;
    const xlsxPath = `${basePath}/mailing-list-${timestamp}.xlsx`;

    const csvBlob = new Blob([csvContent], { type: 'text/csv' });
    const { error: csvError } = await serviceClient.storage.from(EXPORT_BUCKET).upload(csvPath, csvBlob, {
      contentType: 'text/csv',
      upsert: true,
    });
    if (csvError) {
      throw csvError;
    }

    const xlsxBlob = new Blob([xlsxContent], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const { error: xlsxError } = await serviceClient.storage.from(EXPORT_BUCKET).upload(xlsxPath, xlsxBlob, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: true,
    });
    if (xlsxError) {
      throw xlsxError;
    }

    await updateJob(job.id, {
      status: 'completed',
      file_paths: { csv: csvPath, xlsx: xlsxPath },
      error: null,
    });
  } catch (error) {
    console.error('Mailing list export failed', { error });
    const message = error instanceof Error ? error.message : 'Unknown export error';
    await updateJob(job.id, { status: 'failed', error: message });
  }
}

async function createSignedUrls(filePaths: { csv?: string | null; xlsx?: string | null } | null): Promise<{
  csv?: string | null;
  xlsx?: string | null;
}> {
  if (!filePaths) {
    return {};
  }

  const entries: Array<[keyof typeof filePaths, string | null]> = [
    ['csv', filePaths.csv ?? null],
    ['xlsx', filePaths.xlsx ?? null],
  ];

  const signed: { csv?: string | null; xlsx?: string | null } = {};

  for (const [key, path] of entries) {
    if (!path) {
      signed[key] = null;
      continue;
    }
    const { data, error } = await serviceClient.storage
      .from(EXPORT_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error) {
      console.error('Failed to create signed URL', { path, error });
      signed[key] = null;
      continue;
    }
    signed[key] = data?.signedUrl ?? null;
  }

  return signed;
}

async function handleCreate(filtersInput: unknown, regionsInput: unknown): Promise<Response> {
  const filters = normaliseFilters(filtersInput);
  const regions = normaliseRegions(regionsInput);

  const job = await createJob(filters, regions);

  processMailingListJob(job).catch((error) => {
    console.error('Unhandled mailing list export failure', { jobId: job.id, error });
  });

  const payload = serialiseJob(job);
  return jsonResponse({ job: payload }, 202);
}

async function handleStatus(jobId: unknown): Promise<Response> {
  if (typeof jobId !== 'string' || jobId.length === 0) {
    return jsonResponse({ error: 'jobId is required.' }, 400);
  }

  const job = await fetchJob(jobId);
  if (!job) {
    return jsonResponse({ error: 'Job not found.' }, 404);
  }

  const signedUrls = await createSignedUrls(job.file_paths ?? null);
  const payload = serialiseJob(job, signedUrls);
  return jsonResponse({ job: payload }, 200);
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch (error) {
    console.error('Invalid JSON payload received', error);
    return jsonResponse({ error: 'Invalid JSON payload.' }, 400);
  }

  const action = body.action;
  if (action === 'create') {
    return handleCreate(body.filters, body.regions);
  }
  if (action === 'status') {
    return handleStatus(body.jobId);
  }

  return jsonResponse({ error: 'Unsupported action.' }, 400);
});
