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
  renewalTimelineBuckets: number;
  renewalSummaryBuckets: number;
  renewalMethodBuckets: number;
  landBaronsWritten: number;
  totalBusinessOwners: number;
  totalIndividualOwners: number;
  businessOwnerReclassifications: number;
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
const RENEWAL_TIMELINE_VIEW = 'listing_renewal_timeline';
const RENEWAL_SUMMARY_VIEW = 'listing_renewal_summary_view';
const RENEWAL_METHOD_VIEW = 'listing_renewal_method_breakdown';
const LAND_BARON_VIEW = 'land_baron_leaderboard_view';

export async function fetchListingMetrics(): Promise<ListingMetrics> {
  const client = assertSupabaseClient();

  const [
    subdivisionsResult,
    zonesResult,
    renewalTimelineResult,
    renewalSummaryResult,
    renewalMethodResult,
    landBaronResult,
  ] = await Promise.all([
    client.from(SUBDIVISION_VIEW).select('*'),
    client.from(ZONE_VIEW).select('*'),
    client.from(RENEWAL_TIMELINE_VIEW).select('*'),
    client.from(RENEWAL_SUMMARY_VIEW).select('*'),
    client.from(RENEWAL_METHOD_VIEW).select('*'),
    client.from(LAND_BARON_VIEW).select('*'),
  ]);

  if (subdivisionsResult.error) {
    throw subdivisionsResult.error;
  }
  if (zonesResult.error) {
    throw zonesResult.error;
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
  if (landBaronResult.error) {
    throw landBaronResult.error;
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

  const zones: ZoneMetric[] = (zonesResult.data as RawZoneMetric[] | null | undefined)?.map((row) => ({
    zone: row.zone && row.zone.trim().length > 0 ? row.zone : 'Unknown zone',
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

  const landBarons: LandBaronMetric[] = (landBaronResult.data as RawLandBaronMetric[] | null | undefined)?.map((row) => ({
    ownerName:
      row.owner_name && row.owner_name.trim().length > 0 ? row.owner_name.trim() : 'Unknown owner',
    propertyCount: typeof row.property_count === 'number' ? row.property_count : 0,
    businessPropertyCount:
      typeof row.business_property_count === 'number' ? row.business_property_count : 0,
    individualPropertyCount:
      typeof row.individual_property_count === 'number' ? row.individual_property_count : 0,
    updatedAt: parseDate(row.updated_at),
  })) ?? [];

  subdivisions.sort((a, b) => b.totalListings - a.totalListings || a.subdivision.localeCompare(b.subdivision));
  zones.sort((a, b) => b.totalListings - a.totalListings || a.zone.localeCompare(b.zone));
  renewalTimeline.sort((a, b) => a.renewalMonth.getTime() - b.renewalMonth.getTime());
  renewalMethods.sort((a, b) => b.listingCount - a.listingCount || a.method.localeCompare(b.method));
  landBarons.sort((a, b) => b.propertyCount - a.propertyCount || a.ownerName.localeCompare(b.ownerName));

  return {
    subdivisions,
    zones,
    renewalTimeline,
    renewalSummary,
    renewalMethods,
    landBarons,
  };
}

export function deriveLatestMetricsTimestamp(metrics: ListingMetrics): Date | null {
  const timestamps: (Date | null)[] = [
    ...metrics.subdivisions.map((item) => item.updatedAt),
    ...metrics.zones.map((item) => item.updatedAt),
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
