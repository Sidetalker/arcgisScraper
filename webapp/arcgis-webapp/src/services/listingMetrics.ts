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

export interface ZoningMetric {
  zoningDistrict: string;
  totalListings: number;
  businessOwnerCount: number;
  individualOwnerCount: number;
  updatedAt: Date | null;
}

export interface LandUseMetric {
  landUseCategory: string;
  totalListings: number;
  businessOwnerCount: number;
  individualOwnerCount: number;
  updatedAt: Date | null;
}

export interface ListingMetrics {
  subdivisions: SubdivisionMetric[];
  zoning: ZoningMetric[];
  landUse: LandUseMetric[];
  renewalTimeline: RenewalMetric[];
  renewalSummary: RenewalSummaryMetric[];
  renewalMethods: RenewalMethodMetric[];
}

export interface ListingMetricsRefreshResult {
  refreshedAt: string;
  listingsProcessed: number;
  subdivisionsWritten: number;
  renewalTimelineBuckets: number;
  renewalSummaryBuckets: number;
  renewalMethodBuckets: number;
  totalBusinessOwners: number;
  totalIndividualOwners: number;
}

interface RawSubdivisionMetric {
  subdivision: string | null;
  total_listings: number | null;
  business_owner_count: number | null;
  individual_owner_count: number | null;
  updated_at: string | null;
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

interface RawZoningMetric {
  zoning_district: string | null;
  total_listings: number | null;
  business_owner_count: number | null;
  individual_owner_count: number | null;
  updated_at: string | null;
}

interface RawLandUseMetric {
  land_use_category: string | null;
  total_listings: number | null;
  business_owner_count: number | null;
  individual_owner_count: number | null;
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
const ZONING_VIEW = 'listing_zoning_overview';
const LAND_USE_VIEW = 'listing_land_use_overview';
const RENEWAL_TIMELINE_VIEW = 'listing_renewal_timeline';
const RENEWAL_SUMMARY_VIEW = 'listing_renewal_summary_view';
const RENEWAL_METHOD_VIEW = 'listing_renewal_method_breakdown';

export async function fetchListingMetrics(): Promise<ListingMetrics> {
  const client = assertSupabaseClient();

  const [
    subdivisionsResult,
    zoningResult,
    landUseResult,
    renewalTimelineResult,
    renewalSummaryResult,
    renewalMethodResult,
  ] = await Promise.all([
    client.from(SUBDIVISION_VIEW).select('*'),
    client.from(ZONING_VIEW).select('*'),
    client.from(LAND_USE_VIEW).select('*'),
    client.from(RENEWAL_TIMELINE_VIEW).select('*'),
    client.from(RENEWAL_SUMMARY_VIEW).select('*'),
    client.from(RENEWAL_METHOD_VIEW).select('*'),
  ]);

  if (subdivisionsResult.error) {
    throw subdivisionsResult.error;
  }
  if (zoningResult.error) {
    throw zoningResult.error;
  }
  if (landUseResult.error) {
    throw landUseResult.error;
  }
  if (renewalTimelineResult.error) {
    throw renewalTimelineResult.error;
  }
  if (renewalSummaryResult.error) {
    throw renewalSummaryResult.error;
  }
  if (renewalMethodResult.error) {
    throw renewalMethodResult.error;
  }

  const subdivisions: SubdivisionMetric[] = (subdivisionsResult.data as RawSubdivisionMetric[] | null | undefined)?.map(
    (row) => ({
      subdivision: row.subdivision && row.subdivision.trim().length > 0 ? row.subdivision : 'Unknown subdivision',
      totalListings: typeof row.total_listings === 'number' ? row.total_listings : 0,
      businessOwnerCount: typeof row.business_owner_count === 'number' ? row.business_owner_count : 0,
      individualOwnerCount: typeof row.individual_owner_count === 'number' ? row.individual_owner_count : 0,
      updatedAt: parseDate(row.updated_at),
    }),
  ) ?? [];

  const zoning: ZoningMetric[] = (zoningResult.data as RawZoningMetric[] | null | undefined)?.map((row) => ({
    zoningDistrict:
      row.zoning_district && row.zoning_district.trim().length > 0
        ? row.zoning_district
        : 'Unknown zoning',
    totalListings: typeof row.total_listings === 'number' ? row.total_listings : 0,
    businessOwnerCount: typeof row.business_owner_count === 'number' ? row.business_owner_count : 0,
    individualOwnerCount: typeof row.individual_owner_count === 'number' ? row.individual_owner_count : 0,
    updatedAt: parseDate(row.updated_at),
  })) ?? [];

  const landUse: LandUseMetric[] = (landUseResult.data as RawLandUseMetric[] | null | undefined)?.map((row) => ({
    landUseCategory:
      row.land_use_category && row.land_use_category.trim().length > 0
        ? row.land_use_category
        : 'Unknown land use',
    totalListings: typeof row.total_listings === 'number' ? row.total_listings : 0,
    businessOwnerCount: typeof row.business_owner_count === 'number' ? row.business_owner_count : 0,
    individualOwnerCount: typeof row.individual_owner_count === 'number' ? row.individual_owner_count : 0,
    updatedAt: parseDate(row.updated_at),
  })) ?? [];

  const renewalTimeline: RenewalMetric[] = (renewalTimelineResult.data as RawRenewalMetric[] | null | undefined)?.map(
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
  ) ?? [];

  const renewalSummary: RenewalSummaryMetric[] = (renewalSummaryResult.data as RawRenewalSummaryMetric[] | null | undefined)?.map(
    (row) => ({
      category: row.category,
      listingCount: typeof row.listing_count === 'number' ? row.listing_count : 0,
      windowStart: parseDate(row.window_start),
      windowEnd: parseDate(row.window_end),
      updatedAt: parseDate(row.updated_at),
    }),
  ) ?? [];

  const renewalMethods: RenewalMethodMetric[] = (renewalMethodResult.data as RawRenewalMethodMetric[] | null | undefined)?.map(
    (row) => ({
      method: row.method,
      listingCount: typeof row.listing_count === 'number' ? row.listing_count : 0,
      updatedAt: parseDate(row.updated_at),
    }),
  ) ?? [];

  subdivisions.sort((a, b) => b.totalListings - a.totalListings || a.subdivision.localeCompare(b.subdivision));
  zoning.sort((a, b) => b.totalListings - a.totalListings || a.zoningDistrict.localeCompare(b.zoningDistrict));
  landUse.sort((a, b) => b.totalListings - a.totalListings || a.landUseCategory.localeCompare(b.landUseCategory));
  renewalTimeline.sort((a, b) => a.renewalMonth.getTime() - b.renewalMonth.getTime());
  renewalMethods.sort((a, b) => b.listingCount - a.listingCount || a.method.localeCompare(b.method));

  return {
    subdivisions,
    zoning,
    landUse,
    renewalTimeline,
    renewalSummary,
    renewalMethods,
  };
}

export function deriveLatestMetricsTimestamp(metrics: ListingMetrics): Date | null {
  const timestamps: (Date | null)[] = [
    ...metrics.subdivisions.map((item) => item.updatedAt),
    ...metrics.zoning.map((item) => item.updatedAt),
    ...metrics.landUse.map((item) => item.updatedAt),
    ...metrics.renewalTimeline.map((item) => item.updatedAt),
    ...metrics.renewalSummary.map((item) => item.updatedAt),
    ...metrics.renewalMethods.map((item) => item.updatedAt),
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
