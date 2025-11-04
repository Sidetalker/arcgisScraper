import { assertSupabaseClient } from '@/services/supabaseClient';

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

export interface ListingMetrics {
  subdivisions: SubdivisionMetric[];
  renewalTimeline: RenewalMetric[];
  renewalSummary: RenewalSummaryMetric[];
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

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const SUBDIVISION_VIEW = 'listing_subdivision_overview';
const RENEWAL_TIMELINE_VIEW = 'listing_renewal_timeline';
const RENEWAL_SUMMARY_VIEW = 'listing_renewal_summary_view';

export async function fetchListingMetrics(): Promise<ListingMetrics> {
  const client = assertSupabaseClient();

  const [subdivisionsResult, renewalTimelineResult, renewalSummaryResult] = await Promise.all([
    client.from(SUBDIVISION_VIEW).select('*'),
    client.from(RENEWAL_TIMELINE_VIEW).select('*'),
    client.from(RENEWAL_SUMMARY_VIEW).select('*'),
  ]);

  if (subdivisionsResult.error) {
    throw subdivisionsResult.error;
  }
  if (renewalTimelineResult.error) {
    throw renewalTimelineResult.error;
  }
  if (renewalSummaryResult.error) {
    throw renewalSummaryResult.error;
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

  subdivisions.sort((a, b) => b.totalListings - a.totalListings || a.subdivision.localeCompare(b.subdivision));
  renewalTimeline.sort((a, b) => a.renewalMonth.getTime() - b.renewalMonth.getTime());

  return {
    subdivisions,
    renewalTimeline,
    renewalSummary,
  };
}

export function deriveLatestMetricsTimestamp(metrics: ListingMetrics): Date | null {
  const timestamps: (Date | null)[] = [
    ...metrics.subdivisions.map((item) => item.updatedAt),
    ...metrics.renewalTimeline.map((item) => item.updatedAt),
    ...metrics.renewalSummary.map((item) => item.updatedAt),
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
