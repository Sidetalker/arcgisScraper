import { useCallback, useEffect, useMemo, useState } from 'react';

import nonPersonOwnerNames from '@/data/nonPersonOwnerNames.json';

import {
  deriveLatestMetricsTimestamp,
  fetchListingMetrics,
  triggerListingMetricsRefresh,
  type ListingMetrics,
  type ListingMetricsRefreshResult,
  type RenewalSummaryMetric,
  type SubdivisionMetric,
} from '@/services/listingMetrics';
import { computeRenewalMonthKey } from '@/services/renewalEstimator';
import type { ListingFilters } from '@/types';

interface ListingInsightsProps {
  supabaseAvailable: boolean;
  filters: ListingFilters;
  onFiltersChange: (filters: ListingFilters) => void;
}

const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  year: 'numeric',
});

const DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, count: number): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
  return result;
}

function formatMonth(date: Date): string {
  return MONTH_FORMATTER.format(date);
}

const SUMMARY_ORDER = ['overdue', 'due_30', 'due_60', 'due_90', 'future', 'missing'] as const;
type SummaryCategory = (typeof SUMMARY_ORDER)[number];

const SUMMARY_DESCRIPTORS: Record<
  SummaryCategory,
  { label: string; description: string; tone: 'danger' | 'warn' | 'info' | 'muted' }
> = {
  overdue: {
    label: 'Overdue',
    description: 'Estimated renewals that have already lapsed and need urgent follow-up.',
    tone: 'danger',
  },
  due_30: {
    label: 'Due in 30 days',
    description: 'Estimated renewals expected within the next 30 days.',
    tone: 'warn',
  },
  due_60: {
    label: 'Due in 60 days',
    description: 'Estimated renewals scheduled for the 31–60 day window.',
    tone: 'warn',
  },
  due_90: {
    label: 'Due in 90 days',
    description: 'Estimated renewals 61–90 days out.',
    tone: 'info',
  },
  future: {
    label: '90+ days out',
    description: 'Estimated renewals more than three months away.',
    tone: 'info',
  },
  missing: {
    label: 'Missing date',
    description: 'Listings without enough structured data to infer a renewal date.',
    tone: 'muted',
  },
};

const SUBDIVISION_LIMIT_OPTIONS = [5, 8, 10, 15, 20];
const LAND_BARON_SECTION_SIZE = 5;

const MANUAL_NON_PERSON_NAMES = new Set(
  (nonPersonOwnerNames as string[]).map((value) => value.toUpperCase()),
);

const ORGANIZATION_PATTERNS: RegExp[] = [
  /\b(?:LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO\.|LTD|LIMITED|LP|L\.P\.|LLP|L\.L\.P\.|LLLP|PLC|PLLC|PC|P\.C\.|RLLP)\b/,
  /\b(?:ASSOCIATION|ASSN|ASSOC|HOA|POA|COA|MASTER|HOMEOWNERS?|CONDOMINIUMS?|CONDOMINIUM|CONDO|RESORT|LODGE|HOTEL|INN|TIMESHARE|VACATION|VILLAGE|CLUB|RESIDENCES?|SUITES|APARTMENTS?|COMMON ELEMENT)\b/,
  /\b(?:PARTNERS|PARTNERSHIP|INVESTMENTS?|INVESTORS?|CAPITAL|VENTURES?|ENTERPRISES?|GROUP|MANAGEMENT|MGMT|SERVICES?|SOLUTIONS?|ADVISORS?|CONSULTING|HOLDINGS?|HOLDING|DEVELOPMENT|DEVELOPERS?|PROPERTIES?|PROPERTY|REALTY|REAL ESTATE|HOMES?|HOSPITALITY|OPERATIONS|OPERATION|LODGING|RENTALS?)\b/,
  /\b(?:TRUST|ESTATE|FOUNDATION|FUND|MINISTRIES|CHURCH|CATHOLIC|LUTHERAN|METHODIST|PRESBYTERIAN|EPISCOPAL|SOCIETY|HOSPITAL|UNIVERSITY|COLLEGE|SCHOOL|ACADEMY|BANK|MORTGAGE|CREDIT UNION|ASSOCIATES?)\b/,
  /\b(?:TOWN|CITY|COUNTY|STATE|DISTRICT|DEPARTMENT|DEPT|AUTHORITY|BOARD|COMMISSIONERS?|COMMISSION|COUNCIL|HOUSING|URBAN|RENEWAL|METROPOLITAN|GOVERNMENT|PUBLIC|FIRE PROTECTION|FIRE DISTRICT|SANITATION|METRO DISTRICT)\b/,
  /\b(?:C\/O|CARE OF|ET AL|ET UX|ET VIR|ET ALIA)\b/,
  /\b(?:UNITED STATES|U\.S\.|USA)\b/,
  /\b(?:SUMMIT COUNTY|BRECKENRIDGE|DILLON|FRISCO|SILVERTHORNE|COPPER MOUNTAIN|KEYSTONE) (?:TOWN|CITY|COUNTY|METRO|AUTHORITY)\b/,
  /[#]/,
];

function isLikelyOrganization(name: string | null | undefined): boolean {
  if (!name) {
    return true;
  }
  const normalised = name.trim();
  if (normalised.length === 0) {
    return true;
  }
  const collapsed = normalised.replace(/\s+/g, ' ');
  const upper = collapsed.toUpperCase();
  if (MANUAL_NON_PERSON_NAMES.has(upper)) {
    return true;
  }
  for (const pattern of ORGANIZATION_PATTERNS) {
    if (pattern.test(upper)) {
      return true;
    }
  }
  if (/\d/.test(upper) && !/\b(?:I|II|III|IV|V)\b/.test(upper)) {
    return true;
  }
  return false;
}

function resolveSummaryDescriptor(category: RenewalSummaryMetric['category']) {
  if (SUMMARY_ORDER.includes(category as SummaryCategory)) {
    return SUMMARY_DESCRIPTORS[category as SummaryCategory];
  }
  return SUMMARY_DESCRIPTORS.missing;
}

const METHOD_DESCRIPTORS: Record<
  string,
  { label: string; description: string; tone: 'info' | 'warn' | 'muted' }
> = {
  direct_permit: {
    label: 'Permit source',
    description: 'Actual expiration captured directly from permit or license metadata.',
    tone: 'info',
  },
  transfer_cycle: {
    label: 'Ownership change cadence',
    description: 'Derived by projecting the most recent sale or recorded document forward on a yearly cycle.',
    tone: 'info',
  },
  assessment_cycle: {
    label: 'County reassessment cycle',
    description: 'Projected to the next odd-year valuation milestone based on assessor assessment dates.',
    tone: 'info',
  },
  update_cycle: {
    label: 'Update cadence',
    description: 'Anchored to general record updates when no sale or assessment data is available.',
    tone: 'warn',
  },
  generic_cycle: {
    label: 'Fallback cadence',
    description: 'Fallback annual projection when no better renewal signal is present.',
    tone: 'muted',
  },
};

function resolveMethodDescriptor(method: string) {
  return METHOD_DESCRIPTORS[method] ?? {
    label: method,
    description: 'Estimated using the most recent timestamp in the parcel record.',
    tone: 'muted',
  };
}

type DisplaySubdivisionMetric = SubdivisionMetric & { synthetic?: boolean };

function buildSubdivisionDisplay(
  subdivisions: SubdivisionMetric[],
  limit: number,
): DisplaySubdivisionMetric[] {
  if (limit <= 0) {
    return [];
  }

  if (subdivisions.length <= limit) {
    return subdivisions.slice(0, limit);
  }

  const top = subdivisions.slice(0, limit);
  const remaining = subdivisions.slice(limit);
  const totalListings = remaining.reduce((sum, item) => sum + item.totalListings, 0);
  if (totalListings === 0) {
    return top;
  }

  const businessOwnerCount = remaining.reduce((sum, item) => sum + item.businessOwnerCount, 0);
  const individualOwnerCount = remaining.reduce((sum, item) => sum + item.individualOwnerCount, 0);

  return [
    ...top,
    {
      subdivision: 'Other subdivisions',
      totalListings,
      businessOwnerCount,
      individualOwnerCount,
      updatedAt: top[0]?.updatedAt ?? null,
      synthetic: true,
    },
  ];
}

function toggleStringValue(list: string[], value: string): string[] {
  const normalised = value.toLowerCase();
  const existingIndex = list.findIndex((item) => item.toLowerCase() === normalised);
  if (existingIndex === -1) {
    return [...list, value];
  }
  return list.filter((_, index) => index !== existingIndex);
}

function isStringActive(list: string[], value: string): boolean {
  return list.some((item) => item.toLowerCase() === value.toLowerCase());
}

function filterTimeline(metrics: ListingMetrics | null): ListingMetrics['renewalTimeline'] {
  if (!metrics) {
    return [];
  }

  const now = new Date();
  const start = addMonths(startOfMonth(now), -2);
  const end = addMonths(startOfMonth(now), 11);

  return metrics.renewalTimeline.filter((item) => {
    const month = startOfMonth(item.renewalMonth);
    return month >= start && month <= end;
  });
}

function ListingInsights({ supabaseAvailable, filters, onFiltersChange }: ListingInsightsProps): JSX.Element {
  const [metrics, setMetrics] = useState<ListingMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [jobRunning, setJobRunning] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [lastSupabaseRunAt, setLastSupabaseRunAt] = useState<Date | null>(null);
  const [subdivisionLimit, setSubdivisionLimit] = useState<number>(8);

  const loadMetrics = useCallback(async () => {
    if (!supabaseAvailable) {
      setMetrics(null);
      setError('Supabase client is not configured. Provide Supabase credentials to enable insights.');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await fetchListingMetrics();
      setMetrics(result);
      setError(null);
      setLastLoadedAt(new Date());
    } catch (loadError) {
      console.error('Failed to load listing metrics.', loadError);
      const message =
        loadError instanceof Error ? loadError.message : 'Unable to load metrics from Supabase.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  const handleSupabaseRefresh = useCallback(async () => {
    if (!supabaseAvailable) {
      setJobError('Supabase client is not configured. Provide Supabase credentials to run the refresh job.');
      setJobStatus(null);
      return;
    }

    setJobRunning(true);
    setJobError(null);
    setJobStatus('Starting Supabase refresh…');

    try {
      const result: ListingMetricsRefreshResult = await triggerListingMetricsRefresh();
      const refreshedAt = new Date(result.refreshedAt);
      const safeRefreshedAt = Number.isNaN(refreshedAt.getTime()) ? new Date() : refreshedAt;
      setLastSupabaseRunAt(safeRefreshedAt);
      const ownersWritten =
        typeof result.landBaronsWritten === 'number' ? result.landBaronsWritten : 0;
      const businessReclassified =
        typeof result.businessOwnerReclassifications === 'number'
          ? result.businessOwnerReclassifications
          : 0;
      setJobStatus(
        `Supabase processed ${result.listingsProcessed.toLocaleString()} listings across ${result.subdivisionsWritten} subdivisions, reclassified ${businessReclassified.toLocaleString()} business owners, and tallied ${ownersWritten.toLocaleString()} owners. Loading latest insights…`,
      );
      await loadMetrics();
      setJobStatus(
        `Supabase processed ${result.listingsProcessed.toLocaleString()} listings across ${result.subdivisionsWritten} subdivisions, reclassified ${businessReclassified.toLocaleString()} business owners, and tallied ${ownersWritten.toLocaleString()} owners. Insights refreshed.`,
      );
    } catch (refreshError) {
      console.error('Failed to trigger listing metrics refresh.', refreshError);
      const message =
        refreshError instanceof Error ? refreshError.message : 'Unable to run Supabase refresh job.';
      setJobError(message);
      setJobStatus(null);
    } finally {
      setJobRunning(false);
    }
  }, [loadMetrics, supabaseAvailable]);

  useEffect(() => {
    if (!supabaseAvailable) {
      setMetrics(null);
      setLastLoadedAt(null);
      setJobStatus(null);
      setJobError(null);
      setJobRunning(false);
      setLastSupabaseRunAt(null);
      return;
    }

    void loadMetrics();
  }, [loadMetrics, supabaseAvailable]);

  const subdivisionRows = useMemo(() => {
    if (!metrics) {
      return [] as DisplaySubdivisionMetric[];
    }
    return buildSubdivisionDisplay(metrics.subdivisions, subdivisionLimit);
  }, [metrics, subdivisionLimit]);

  const landBaronEntries = useMemo(() => {
    if (!metrics) {
      return [] as ListingMetrics['landBarons'];
    }
    return metrics.landBarons.slice();
  }, [metrics]);

  const topPortfolioLandBarons = useMemo(() => {
    return landBaronEntries.slice(0, LAND_BARON_SECTION_SIZE);
  }, [landBaronEntries]);

  const topIndividualLandBarons = useMemo(() => {
    if (landBaronEntries.length === 0) {
      return [] as ListingMetrics['landBarons'];
    }
    return landBaronEntries
      .filter((entry) => entry.individualPropertyCount >= 2)
      .filter((entry) => !isLikelyOrganization(entry.ownerName))
      .sort(
        (a, b) =>
          b.individualPropertyCount - a.individualPropertyCount ||
          a.ownerName.localeCompare(b.ownerName, undefined, { sensitivity: 'base' }),
      )
      .slice(0, LAND_BARON_SECTION_SIZE);
  }, [landBaronEntries]);

  const timelinePoints = useMemo(() => filterTimeline(metrics), [metrics]);

  const summaryEntries = useMemo(() => {
    if (!metrics) {
      return [] as RenewalSummaryMetric[];
    }
    return metrics.renewalSummary.slice().sort((a, b) => {
      const orderA = SUMMARY_ORDER.indexOf(a.category as SummaryCategory);
      const orderB = SUMMARY_ORDER.indexOf(b.category as SummaryCategory);
      const safeA = orderA === -1 ? Number.POSITIVE_INFINITY : orderA;
      const safeB = orderB === -1 ? Number.POSITIVE_INFINITY : orderB;
      return safeA - safeB;
    });
  }, [metrics]);

  const methodEntries = useMemo(() => {
    if (!metrics) {
      return [] as ListingMetrics['renewalMethods'];
    }
    return metrics.renewalMethods.slice();
  }, [metrics]);

  const latestSupabaseUpdate = useMemo(() => {
    if (!metrics) {
      return null;
    }
    return deriveLatestMetricsTimestamp(metrics);
  }, [metrics]);

  const maxSubdivisionListings = useMemo(() => {
    return subdivisionRows.reduce((max, item) => Math.max(max, item.totalListings), 0);
  }, [subdivisionRows]);

  const maxLandBaronProperties = useMemo(() => {
    return topPortfolioLandBarons.reduce((max, item) => Math.max(max, item.propertyCount), 0);
  }, [topPortfolioLandBarons]);

  const maxIndividualLandBaronProperties = useMemo(() => {
    return topIndividualLandBarons.reduce(
      (max, item) => Math.max(max, item.individualPropertyCount),
      0,
    );
  }, [topIndividualLandBarons]);

  const maxRenewalListings = useMemo(() => {
    return timelinePoints.reduce((max, item) => Math.max(max, item.listingCount), 0);
  }, [timelinePoints]);

  const totalLandBarons = metrics?.landBarons.length ?? 0;

  const handleSubdivisionToggle = useCallback(
    (subdivision: string, synthetic?: boolean) => {
      if (synthetic) {
        return;
      }
      const next = toggleStringValue(filters.subdivisions, subdivision);
      onFiltersChange({ ...filters, subdivisions: next });
    },
    [filters, onFiltersChange],
  );

  const handleRenewalCategoryToggle = useCallback(
    (category: string) => {
      const next = toggleStringValue(filters.renewalCategories, category);
      onFiltersChange({ ...filters, renewalCategories: next });
    },
    [filters, onFiltersChange],
  );

  const handleRenewalMethodToggle = useCallback(
    (method: string) => {
      const next = toggleStringValue(filters.renewalMethods, method);
      onFiltersChange({ ...filters, renewalMethods: next });
    },
    [filters, onFiltersChange],
  );

  const handleMonthToggle = useCallback(
    (monthKey: string) => {
      const next = toggleStringValue(filters.renewalMonths, monthKey);
      onFiltersChange({ ...filters, renewalMonths: next });
    },
    [filters, onFiltersChange],
  );

  return (
    <section className="insights" aria-labelledby="listing-insights-title">
      <header className="insights__header">
        <div>
          <h2 id="listing-insights-title">Market insights</h2>
          <p>
            Supabase aggregates spotlight high-volume subdivisions and renewal signals. Click any insight to instantly
            filter the listings table and regional map.
          </p>
        </div>
        <div className="insights__meta">
          <div className="insights__timestamps">
            {latestSupabaseUpdate ? (
              <span className="insights__timestamp">
                Supabase refreshed {latestSupabaseUpdate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            ) : (
              <span className="insights__timestamp insights__timestamp--muted">No metrics available yet.</span>
            )}
            {lastLoadedAt ? (
              <span className="insights__timestamp insights__timestamp--muted">
                Loaded in-app {lastLoadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
            {lastSupabaseRunAt ? (
              <span className="insights__timestamp insights__timestamp--muted">
                Refresh job finished {lastSupabaseRunAt.toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            ) : null}
          </div>
          {jobStatus ? <p className="insights__job-status">{jobStatus}</p> : null}
          {jobError ? <p className="insights__job-status insights__job-status--error">{jobError}</p> : null}
          <div className="insights__actions">
            <button
              type="button"
              className="insights__button"
              onClick={() => {
                void handleSupabaseRefresh();
              }}
              disabled={jobRunning || loading || !supabaseAvailable}
            >
              {jobRunning ? 'Running Supabase refresh…' : 'Run Supabase refresh'}
            </button>
            <button
              type="button"
              className="insights__button insights__button--secondary"
              onClick={() => {
                void loadMetrics();
              }}
              disabled={loading || jobRunning || !supabaseAvailable}
            >
              {loading ? 'Refreshing…' : 'Refresh insights'}
            </button>
          </div>
        </div>
      </header>

      {error ? <p className="insights__error">{error}</p> : null}

      {!error && !metrics && !loading ? (
        <p className="insights__empty">Metrics will appear after the first successful Supabase sync.</p>
      ) : null}

      <div className="insights__cards">
        <article className="insight-card insight-card--subdivisions" aria-labelledby="insights-top-subdivisions">
          <div className="insight-card__header">
            <div>
              <h3 id="insights-top-subdivisions">Subdivision hotspots</h3>
              <p className="insight-card__description">Largest clusters by listing volume. Tap a row to filter the results.</p>
            </div>
            <label className="insight-card__control" htmlFor="insights-top-n">
              <span>Show</span>
              <select
                id="insights-top-n"
                value={subdivisionLimit}
                onChange={(event) => setSubdivisionLimit(Number(event.target.value))}
              >
                {SUBDIVISION_LIMIT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    Top {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {subdivisionRows.length === 0 ? (
            <p className="insight-card__empty">No subdivision data available.</p>
          ) : (
            <ul className="insight-card__list">
              {subdivisionRows.map((item) => {
                const percentage = maxSubdivisionListings
                  ? Math.max(12, Math.round((item.totalListings / maxSubdivisionListings) * 100))
                  : 0;
                const businessShare = item.totalListings
                  ? Math.round((item.businessOwnerCount / item.totalListings) * 100)
                  : 0;
                const active = isStringActive(filters.subdivisions, item.subdivision);
                return (
                  <li key={item.subdivision}>
                    <button
                      type="button"
                      className={`insight-card__list-item${active ? ' insight-card__list-item--active' : ''}${
                        item.synthetic ? ' insight-card__list-item--disabled' : ''
                      }`}
                      onClick={() => handleSubdivisionToggle(item.subdivision, item.synthetic)}
                      disabled={Boolean(item.synthetic)}
                      aria-pressed={active}
                    >
                      <div className="insight-card__list-line">
                        <span className="insight-card__list-label">{item.subdivision}</span>
                        <span className="insight-card__list-value">{item.totalListings.toLocaleString()}</span>
                      </div>
                      <div className="insight-card__bar" aria-hidden="true">
                        <span className="insight-card__bar-fill" style={{ width: `${percentage}%` }} />
                      </div>
                      <div className="insight-card__list-meta">
                        <span className="insight-card__badge">{businessShare}% business-owned</span>
                        <span className="insight-card__badge insight-card__badge--muted">
                          {item.individualOwnerCount.toLocaleString()} individual owners
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="insight-card__hint">Subdivision filters sync with the search inputs and drawn map regions.</p>
        </article>

        <article className="insight-card insight-card--land-barons" aria-labelledby="insights-land-barons">
          <div className="insight-card__header">
            <div>
              <h3 id="insights-land-barons">Land Baron Leaderboard</h3>
              <p className="insight-card__description">
                Meet the owners linked to the most Summit County properties in the Supabase cache.
              </p>
            </div>
          </div>
          {topPortfolioLandBarons.length === 0 && topIndividualLandBarons.length === 0 ? (
            <p className="insight-card__empty">No owner records available yet.</p>
          ) : (
            <>
              {topPortfolioLandBarons.length > 0 && (
                <div className="insight-card__leaderboard-section">
                  <h4 className="insight-card__leaderboard-heading">Largest Portfolios</h4>
                  <ol className="insight-card__leaderboard">
                    {topPortfolioLandBarons.map((entry, index) => {
                      const percentage = maxLandBaronProperties
                        ? Math.max(12, Math.round((entry.propertyCount / maxLandBaronProperties) * 100))
                        : 0;
                      return (
                        <li key={`portfolio-${entry.ownerName}-${index}`}>
                          <div className="insight-card__leaderboard-item">
                            <div className="insight-card__leaderboard-rank" aria-hidden="true">
                              {index + 1}
                            </div>
                            <div className="insight-card__leaderboard-content">
                              <div className="insight-card__list-line">
                                <span className="insight-card__list-label">{entry.ownerName}</span>
                                <span className="insight-card__list-value">
                                  {entry.propertyCount.toLocaleString()} properties
                                </span>
                              </div>
                              <div className="insight-card__bar" aria-hidden="true">
                                <span className="insight-card__bar-fill" style={{ width: `${percentage}%` }} />
                              </div>
                              <div className="insight-card__list-meta">
                                <span className="insight-card__badge">
                                  {entry.individualPropertyCount.toLocaleString()} individual-run
                                </span>
                                <span className="insight-card__badge insight-card__badge--muted">
                                  {entry.businessPropertyCount.toLocaleString()} business entities
                                </span>
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
              {topIndividualLandBarons.length > 0 && (
                <div className="insight-card__leaderboard-section">
                  <h4 className="insight-card__leaderboard-heading">Individual Portfolios</h4>
                  <ol className="insight-card__leaderboard">
                    {topIndividualLandBarons.map((entry, index) => {
                      const percentage = maxIndividualLandBaronProperties
                        ? Math.max(
                            12,
                            Math.round((entry.individualPropertyCount / maxIndividualLandBaronProperties) * 100),
                          )
                        : 0;
                      return (
                        <li key={`individual-${entry.ownerName}-${index}`}>
                          <div className="insight-card__leaderboard-item">
                            <div className="insight-card__leaderboard-rank" aria-hidden="true">
                              {index + 1}
                            </div>
                            <div className="insight-card__leaderboard-content">
                              <div className="insight-card__list-line">
                                <span className="insight-card__list-label">{entry.ownerName}</span>
                                <span className="insight-card__list-value">
                                  {entry.individualPropertyCount.toLocaleString()} individual properties
                                </span>
                              </div>
                              <div className="insight-card__bar" aria-hidden="true">
                                <span className="insight-card__bar-fill" style={{ width: `${percentage}%` }} />
                              </div>
                              <div className="insight-card__list-meta">
                                <span className="insight-card__badge">
                                  {entry.propertyCount.toLocaleString()} total holdings
                                </span>
                                <span className="insight-card__badge insight-card__badge--muted">
                                  {entry.businessPropertyCount.toLocaleString()} business entities
                                </span>
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </>
          )}
          <p className="insight-card__hint">
            Totals credit each co-owner on a listing. Leaderboard tracks {totalLandBarons.toLocaleString()} unique owners.
          </p>
        </article>

        <article className="insight-card insight-card--outlook" aria-labelledby="insights-renewal-summary">
          <div className="insight-card__header">
            <div>
              <h3 id="insights-renewal-summary">Renewal outlook</h3>
              <p className="insight-card__description">
                Combine urgency buckets with the signals we used to derive each estimate. Press a tile to focus the table
                on matching listings.
              </p>
            </div>
          </div>
          {summaryEntries.length === 0 ? (
            <p className="insight-card__empty">No renewal summary data available.</p>
          ) : (
            <div className="insights__outlook">
              <div className="insights__summary-grid" role="group" aria-label="Renewal urgency buckets">
                {summaryEntries.map((entry) => {
                  const descriptor = resolveSummaryDescriptor(entry.category);
                  const toneClass = `insights__summary-item--${descriptor.tone}`;
                  const active = isStringActive(filters.renewalCategories, entry.category);
                  return (
                    <button
                      key={entry.category}
                      type="button"
                      className={`insights__summary-item ${toneClass}${active ? ' insights__summary-item--active' : ''}`}
                      onClick={() => handleRenewalCategoryToggle(entry.category)}
                      aria-pressed={active}
                    >
                      <span className="insights__summary-count">{entry.listingCount.toLocaleString()}</span>
                      <span className="insights__summary-label">{descriptor.label}</span>
                      <span className="insights__summary-description">{descriptor.description}</span>
                    </button>
                  );
                })}
              </div>
              <div className="insights__method-panel" aria-labelledby="insights-renewal-methods">
                <h4 id="insights-renewal-methods">How we infer renewals</h4>
                {methodEntries.length === 0 ? (
                  <p className="insight-card__empty">No renewal estimation signals detected in the source data.</p>
                ) : (
                  <ul className="insights__method-list">
                    {methodEntries.map((entry) => {
                      const descriptor = resolveMethodDescriptor(entry.method);
                      const toneClass = `insights__method--${descriptor.tone}`;
                      const active = isStringActive(filters.renewalMethods, entry.method);
                      return (
                        <li key={entry.method}>
                          <button
                            type="button"
                            className={`insights__method ${toneClass}${active ? ' insights__method--active' : ''}`}
                            onClick={() => handleRenewalMethodToggle(entry.method)}
                            aria-pressed={active}
                          >
                            <span className="insights__method-count">{entry.listingCount.toLocaleString()}</span>
                            <div className="insights__method-copy">
                              <span className="insights__method-label">{descriptor.label}</span>
                              <span className="insights__method-description">{descriptor.description}</span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
          <p className="insight-card__hint">
            Urgency buckets use UTC dates and align with the timeline filters below.
          </p>
        </article>

        <article className="insight-card insight-card--timeline" aria-labelledby="insights-renewal-timeline">
          <div className="insight-card__header">
            <div>
              <h3 id="insights-renewal-timeline">Renewal timeline</h3>
              <p className="insight-card__description">
                Visualise the next twelve months of estimated renewals. Select a bar to drill into that renewal cohort.
              </p>
            </div>
          </div>
          {timelinePoints.length === 0 ? (
            <p className="insight-card__empty">No estimated renewal timeline data yet.</p>
          ) : (
            <ul className="insights__timeline-grid">
              {timelinePoints.map((point) => {
                const percentage = maxRenewalListings
                  ? Math.max(12, Math.round((point.listingCount / maxRenewalListings) * 100))
                  : 0;
                const monthKey = computeRenewalMonthKey(point.renewalMonth);
                const active = monthKey ? isStringActive(filters.renewalMonths, monthKey) : false;
                return (
                  <li key={point.renewalMonth.toISOString()}>
                    <button
                      type="button"
                      className={`insights__timeline-button${active ? ' insights__timeline-button--active' : ''}`}
                      onClick={() => {
                        if (monthKey) {
                          handleMonthToggle(monthKey);
                        }
                      }}
                      disabled={!monthKey}
                      aria-pressed={active}
                    >
                      <div className="insights__timeline-header">
                        <span className="insights__timeline-month">{formatMonth(point.renewalMonth)}</span>
                        <span className="insights__timeline-count">{point.listingCount.toLocaleString()}</span>
                      </div>
                      <div className="insights__timeline-track" aria-hidden="true">
                        <span className="insights__timeline-fill" style={{ width: `${percentage}%` }} />
                      </div>
                      <div className="insights__timeline-meta">
                        {point.earliestRenewal && point.latestRenewal ? (
                          <span>
                            Estimated {DAY_FORMATTER.format(point.earliestRenewal)} – {DAY_FORMATTER.format(point.latestRenewal)}
                          </span>
                        ) : point.earliestRenewal ? (
                          <span>First estimated renewal {DAY_FORMATTER.format(point.earliestRenewal)}</span>
                        ) : (
                          <span>Unable to infer exact renewal dates from source data.</span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="insight-card__hint">Selecting a month also updates the urgency summary above.</p>
        </article>
      </div>
    </section>
  );
}

export default ListingInsights;
