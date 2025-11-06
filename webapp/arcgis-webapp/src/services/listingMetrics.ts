import type { PostgrestError } from '@supabase/supabase-js';

import { assertSupabaseClient } from '@/services/supabaseClient';

const METRICS_REFRESH_TOKEN =
  import.meta.env.VITE_METRICS_REFRESH_TOKEN ??
  import.meta.env.NEXT_PUBLIC_METRICS_REFRESH_TOKEN ??
  import.meta.env.METRICS_REFRESH_TOKEN;

export interface SubdivisionMetric {
  subdivision: string;
  totalListings: number;
  businessOwnerCount: number;
  individualOwnerCount: number;
  updatedAt: Date | null;
}

export interface ZoneMetric {
  zone: string;
  totalListings: number;
  businessOwnerCount: number;
  individualOwnerCount: number;
  updatedAt: Date | null;
}

export interface MunicipalityMetric {
  municipality: string;
  totalListings: number;
  licensedListingCount: number;
  businessOwnerCount: number;
  individualOwnerCount: number;
  updatedAt: Date | null;
}

export interface RenewalMetric {
  renewalMonth: Date;
  listingCount: number;
  earliestRenewal: Date | null;
  latestRenewal: Date | null;
  updatedAt: Date | null;
}

export interface RenewalSummaryMetric {
  category: string;
  listingCount: number;
  windowStart: Date | null;
  windowEnd: Date | null;
  updatedAt: Date | null;
}

export interface RenewalMethodMetric {
  method: string;
  listingCount: number;
  updatedAt: Date | null;
}

export interface LandBaronMetric {
  ownerName: string;
  propertyCount: number;
  businessPropertyCount: number;
  individualPropertyCount: number;
  updatedAt: Date | null;
}

export interface ListingMetrics {
  subdivisions: SubdivisionMetric[];
  zones: ZoneMetric[];
  municipalities: MunicipalityMetric[];
  renewalTimeline: RenewalMetric[];
  renewalSummary: RenewalSummaryMetric[];
  renewalMethods: RenewalMethodMetric[];
  landBarons: LandBaronMetric[];
}

export interface ListingMetricsRefreshResult {
  refreshedAt: string;
  listingsProcessed: number;
  subdivisionsWritten: number;
  zonesWritten: number;
  municipalitiesWritten: number;
  renewalTimelineBuckets: number;
  renewalSummaryBuckets: number;
  renewalMethodBuckets: number;
  landBaronsWritten: number;
  totalBusinessOwners: number;
  totalIndividualOwners: number;
  businessOwnerReclassifications: number;
  municipalAssignmentUpdates: number;
}

interface RawSubdivisionMetric {
  subdivision: string | null;
  total_listings: number | null;
  business_owner_count: number | null;
  individual_owner_count: number | null;
  updated_at: string | null;
}

interface RawZoneMetric {
  zone: string | null;
  total_listings: number | null;
  business_owner_count: number | null;
  individual_owner_count: number | null;
  updated_at: string | null;
}

interface RawMunicipalityMetric {
  municipality: string | null;
  total_listings: number | null;
  licensed_listing_count: number | null;
  business_owner_count: number | null;
  individual_owner_count: number | null;
  updated_at: string | null;
}

function parseZoneMetrics(rows: RawZoneMetric[] | null | undefined): ZoneMetric[] {
  return (
    rows?.map((row) => ({
      zone: row.zone && row.zone.trim().length > 0 ? row.zone : 'Unknown zone',
      totalListings: typeof row.total_listings === 'number' ? row.total_listings : 0,
      businessOwnerCount: typeof row.business_owner_count === 'number' ? row.business_owner_count : 0,
      individualOwnerCount: typeof row.individual_owner_count === 'number' ? row.individual_owner_count : 0,
      updatedAt: parseDate(row.updated_at),
    })) ?? []
  );
}

function parseMunicipalityMetrics(
  rows: RawMunicipalityMetric[] | null | undefined,
): MunicipalityMetric[] {
  return (
    rows?.map((row) => ({
      municipality:
        row.municipality && row.municipality.trim().length > 0
          ? row.municipality
          : 'Unknown jurisdiction',
      totalListings: typeof row.total_listings === 'number' ? row.total_listings : 0,
      licensedListingCount:
        typeof row.licensed_listing_count === 'number' ? row.licensed_listing_count : 0,
      businessOwnerCount:
        typeof row.business_owner_count === 'number' ? row.business_owner_count : 0,
      individualOwnerCount:
        typeof row.individual_owner_count === 'number' ? row.individual_owner_count : 0,
      updatedAt: parseDate(row.updated_at),
    })) ?? []
  );
}

interface RawRenewalMetric {
  renewal_month: string;
  listing_count: number | null;
  earliest_renewal: string | null;
  latest_renewal: string | null;
  updated_at: string | null;
}

interface RawRenewalSummaryMetric {
  category: string;
  listing_count: number | null;
  window_start: string | null;
  window_end: string | null;
  updated_at: string | null;
}

interface RawRenewalMethodMetric {
  method: string;
  listing_count: number | null;
  updated_at: string | null;
}

interface RawLandBaronMetric {
  owner_name: string | null;
  property_count: number | null;
  business_property_count: number | null;
  individual_property_count: number | null;
  updated_at: string | null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const SUBDIVISION_VIEW = 'listing_subdivision_overview';
const ZONE_VIEW = 'listing_zone_overview';
const MUNICIPALITY_VIEW = 'listing_municipality_overview';
const RENEWAL_TIMELINE_VIEW = 'listing_renewal_timeline';
const RENEWAL_SUMMARY_VIEW = 'listing_renewal_summary_view';
const RENEWAL_METHOD_VIEW = 'listing_renewal_method_breakdown';
const LAND_BARON_VIEW = 'land_baron_leaderboard_view';

const SCHEMA_CACHE_ERROR_CODES = new Set(['PGRST204', 'PGRST205']);
const SCHEMA_CACHE_RETRY_LIMIT = 5;
const SCHEMA_CACHE_RETRY_DELAY_MS = 750;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isSchemaCacheError(error: PostgrestError | null): boolean {
  return Boolean(error && typeof error.code === 'string' && SCHEMA_CACHE_ERROR_CODES.has(error.code));
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (error instanceof TypeError) {
    return error.message === 'Failed to fetch';
  }

  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.includes('Failed to fetch')) {
      return true;
    }
  }

  return false;
}

async function selectAllRows<T>(view: string, attempt = 0): Promise<T[]> {
  const client = assertSupabaseClient();
  try {
    const { data, error } = await client.from(view).select('*');

    if (error) {
      if (isSchemaCacheError(error) && attempt < SCHEMA_CACHE_RETRY_LIMIT) {
        await wait(SCHEMA_CACHE_RETRY_DELAY_MS);
        return selectAllRows<T>(view, attempt + 1);
      }
      throw error;
    }

    return Array.isArray(data) ? (data as T[]) : [];
  } catch (error) {
    if (isRetryableNetworkError(error) && attempt < SCHEMA_CACHE_RETRY_LIMIT) {
      await wait(SCHEMA_CACHE_RETRY_DELAY_MS);
      return selectAllRows<T>(view, attempt + 1);
    }
    throw error;
  }
}

export async function fetchListingMetrics(): Promise<ListingMetrics> {
  const [
    subdivisionsRows,
    zonesRows,
    municipalitiesRows,
    renewalTimelineRows,
    renewalSummaryRows,
    renewalMethodRows,
    landBaronRows,
  ] = await Promise.all([
    selectAllRows<RawSubdivisionMetric>(SUBDIVISION_VIEW),
    selectAllRows<RawZoneMetric>(ZONE_VIEW),
    selectAllRows<RawMunicipalityMetric>(MUNICIPALITY_VIEW),
    selectAllRows<RawRenewalMetric>(RENEWAL_TIMELINE_VIEW),
    selectAllRows<RawRenewalSummaryMetric>(RENEWAL_SUMMARY_VIEW),
    selectAllRows<RawRenewalMethodMetric>(RENEWAL_METHOD_VIEW),
    selectAllRows<RawLandBaronMetric>(LAND_BARON_VIEW),
  ]);

  const subdivisions: SubdivisionMetric[] = subdivisionsRows.map(
    (row) => ({
      subdivision: row.subdivision && row.subdivision.trim().length > 0 ? row.subdivision : 'Unknown subdivision',
      totalListings: typeof row.total_listings === 'number' ? row.total_listings : 0,
      businessOwnerCount: typeof row.business_owner_count === 'number' ? row.business_owner_count : 0,
      individualOwnerCount: typeof row.individual_owner_count === 'number' ? row.individual_owner_count : 0,
      updatedAt: parseDate(row.updated_at),
    }),
  ) ?? [];

  const zones: ZoneMetric[] = parseZoneMetrics(zonesRows);

  const municipalities: MunicipalityMetric[] = parseMunicipalityMetrics(municipalitiesRows);

  const renewalTimeline: RenewalMetric[] = renewalTimelineRows.map(
    (row) => {
      const parsedMonth = parseDate(row.renewal_month) ?? new Date(row.renewal_month);
      const safeMonth = Number.isNaN(parsedMonth.getTime()) ? new Date() : parsedMonth;
      return {
        renewalMonth: safeMonth,
        listingCount: typeof row.listing_count === 'number' ? row.listing_count : 0,
        earliestRenewal: parseDate(row.earliest_renewal),
        latestRenewal: parseDate(row.latest_renewal),
        updatedAt: parseDate(row.updated_at),
      };
    },
  );

  const renewalSummary: RenewalSummaryMetric[] = renewalSummaryRows.map((row) => ({
    category: row.category,
    listingCount: typeof row.listing_count === 'number' ? row.listing_count : 0,
    windowStart: parseDate(row.window_start),
    windowEnd: parseDate(row.window_end),
    updatedAt: parseDate(row.updated_at),
  }));

  const renewalMethods: RenewalMethodMetric[] = renewalMethodRows.map((row) => ({
    method: row.method,
    listingCount: typeof row.listing_count === 'number' ? row.listing_count : 0,
    updatedAt: parseDate(row.updated_at),
  }));

  const landBarons: LandBaronMetric[] = landBaronRows.map((row) => ({
    ownerName:
      row.owner_name && row.owner_name.trim().length > 0 ? row.owner_name.trim() : 'Unknown owner',
    propertyCount: typeof row.property_count === 'number' ? row.property_count : 0,
    businessPropertyCount:
      typeof row.business_property_count === 'number' ? row.business_property_count : 0,
    individualPropertyCount:
      typeof row.individual_property_count === 'number' ? row.individual_property_count : 0,
    updatedAt: parseDate(row.updated_at),
  }));

  subdivisions.sort((a, b) => b.totalListings - a.totalListings || a.subdivision.localeCompare(b.subdivision));
  zones.sort((a, b) => b.totalListings - a.totalListings || a.zone.localeCompare(b.zone));
  municipalities.sort(
    (a, b) => b.totalListings - a.totalListings || a.municipality.localeCompare(b.municipality),
  );
  renewalTimeline.sort((a, b) => a.renewalMonth.getTime() - b.renewalMonth.getTime());
  renewalMethods.sort((a, b) => b.listingCount - a.listingCount || a.method.localeCompare(b.method));
  landBarons.sort((a, b) => b.propertyCount - a.propertyCount || a.ownerName.localeCompare(b.ownerName));

  return {
    subdivisions,
    zones,
    municipalities,
    renewalTimeline,
    renewalSummary,
    renewalMethods,
    landBarons,
  };
}

export async function fetchZoneMetrics(): Promise<ZoneMetric[]> {
  const rows = await selectAllRows<RawZoneMetric>(ZONE_VIEW);

  const zones = parseZoneMetrics(rows);
  zones.sort((a, b) => b.totalListings - a.totalListings || a.zone.localeCompare(b.zone));
  return zones;
}

export function deriveLatestMetricsTimestamp(metrics: ListingMetrics): Date | null {
  const timestamps: (Date | null)[] = [
    ...metrics.subdivisions.map((item) => item.updatedAt),
    ...metrics.zones.map((item) => item.updatedAt),
    ...metrics.municipalities.map((item) => item.updatedAt),
    ...metrics.renewalTimeline.map((item) => item.updatedAt),
    ...metrics.renewalSummary.map((item) => item.updatedAt),
    ...metrics.renewalMethods.map((item) => item.updatedAt),
    ...metrics.landBarons.map((item) => item.updatedAt),
  ];

  return timestamps.reduce<Date | null>((latest, value) => {
    if (!value) {
      return latest;
    }
    if (!latest || value > latest) {
      return value;
    }
    return latest;
  }, null);
}

export async function triggerListingMetricsRefresh(): Promise<ListingMetricsRefreshResult> {
  const client = assertSupabaseClient();
  const { data, error } = await client.functions.invoke('refresh-listing-metrics', {
    method: 'POST',
    headers: METRICS_REFRESH_TOKEN ? { 'x-metrics-refresh-token': METRICS_REFRESH_TOKEN } : undefined,
  });

  if (error) {
    throw error;
  }

  if (!data || typeof data !== 'object' || data.status !== 'ok' || typeof data.result !== 'object') {
    throw new Error('Unexpected response when requesting listing metrics refresh.');
  }

  return data.result as ListingMetricsRefreshResult;
}
