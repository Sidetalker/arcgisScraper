import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  deriveLatestMetricsTimestamp,
  fetchListingMetrics,
  triggerListingMetricsRefresh,
  type ListingMetrics,
  type ListingMetricsRefreshResult,
  type RenewalSummaryMetric,
  type SubdivisionMetric,
} from '@/services/listingMetrics';

interface ListingInsightsProps {
  supabaseAvailable: boolean;
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

function aggregateRemainingSubdivisions(subdivisions: SubdivisionMetric[]): SubdivisionMetric[] {
  if (subdivisions.length <= 6) {
    return subdivisions;
  }

  const top = subdivisions.slice(0, 6);
  const remaining = subdivisions.slice(6);
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
    },
  ];
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

function ListingInsights({ supabaseAvailable }: ListingInsightsProps): JSX.Element {
  const [metrics, setMetrics] = useState<ListingMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [jobRunning, setJobRunning] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [lastSupabaseRunAt, setLastSupabaseRunAt] = useState<Date | null>(null);

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
      setJobStatus(
        `Supabase processed ${result.listingsProcessed.toLocaleString()} listings across ${result.subdivisionsWritten} subdivisions. Loading latest insights…`,
      );
      await loadMetrics();
      setJobStatus(
        `Supabase processed ${result.listingsProcessed.toLocaleString()} listings across ${result.subdivisionsWritten} subdivisions. Insights refreshed.`,
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

  const topSubdivisions = useMemo(() => {
    if (!metrics) {
      return [] as SubdivisionMetric[];
    }
    return aggregateRemainingSubdivisions(metrics.subdivisions);
  }, [metrics]);

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
    return topSubdivisions.reduce((max, item) => Math.max(max, item.totalListings), 0);
  }, [topSubdivisions]);

  const maxRenewalListings = useMemo(() => {
    return timelinePoints.reduce((max, item) => Math.max(max, item.listingCount), 0);
  }, [timelinePoints]);

  return (
    <section className="insights" aria-labelledby="listing-insights-title">
      <header className="insights__header">
        <div>
          <h2 id="listing-insights-title">Market insights</h2>
          <p>
            Precomputed Supabase aggregates highlight subdivision hot spots and surface upcoming estimated renewal windows
            without reprocessing the raw listings in the browser.
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

      <div className="insights__content">
        <section className="insights__panel" aria-labelledby="insights-top-subdivisions">
          <div className="insights__panel-header">
            <h3 id="insights-top-subdivisions">Top subdivisions</h3>
            <span className="insights__panel-subtitle">Most active neighbourhoods by total listings</span>
          </div>
          {topSubdivisions.length === 0 ? (
            <p className="insights__empty">No subdivision data available.</p>
          ) : (
            <ul className="insights__bars">
              {topSubdivisions.map((item) => {
                const percentage = maxSubdivisionListings
                  ? Math.max(12, Math.round((item.totalListings / maxSubdivisionListings) * 100))
                  : 0;
                const businessShare = item.totalListings
                  ? Math.round((item.businessOwnerCount / item.totalListings) * 100)
                  : 0;
                return (
                  <li key={item.subdivision} className="insights__bar">
                    <div className="insights__bar-label">
                      <span>{item.subdivision}</span>
                      <span>{item.totalListings.toLocaleString()}</span>
                    </div>
                    <div className="insights__bar-track">
                      <div className="insights__bar-fill" style={{ width: `${percentage}%` }} />
                    </div>
                    <div className="insights__bar-meta">
                      <span className="insights__bar-badge">{businessShare}% business-owned</span>
                      <span className="insights__bar-badge insights__bar-badge--muted">
                        {item.individualOwnerCount.toLocaleString()} individual owners
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="insights__panel" aria-labelledby="insights-renewal-summary">
          <div className="insights__panel-header">
            <h3 id="insights-renewal-summary">Renewal outlook</h3>
            <span className="insights__panel-subtitle">Quick actions by estimated renewal urgency</span>
          </div>
          {summaryEntries.length === 0 ? (
            <p className="insights__empty">No renewal summary data available.</p>
          ) : (
            <dl className="insights__summary">
              {summaryEntries.map((entry) => {
                const descriptor = resolveSummaryDescriptor(entry.category);
                const toneClass = `insights__summary-item--${descriptor.tone}`;
                return (
                  <div key={entry.category} className={`insights__summary-item ${toneClass}`}>
                    <dt className="insights__summary-count">{entry.listingCount.toLocaleString()}</dt>
                    <dd className="insights__summary-label">{descriptor.label}</dd>
                    <dd className="insights__summary-description">{descriptor.description}</dd>
                  </div>
                );
              })}
            </dl>
          )}
        </section>

        <section className="insights__panel" aria-labelledby="insights-renewal-methods">
          <div className="insights__panel-header">
            <h3 id="insights-renewal-methods">Renewal estimation signals</h3>
            <span className="insights__panel-subtitle">How inferred renewal dates were derived</span>
          </div>
          {methodEntries.length === 0 ? (
            <p className="insights__empty">No renewal estimation signals detected in the source data.</p>
          ) : (
            <dl className="insights__summary">
              {methodEntries.map((entry) => {
                const descriptor = resolveMethodDescriptor(entry.method);
                const toneClass = `insights__summary-item--${descriptor.tone}`;
                return (
                  <div key={entry.method} className={`insights__summary-item ${toneClass}`}>
                    <dt className="insights__summary-count">{entry.listingCount.toLocaleString()}</dt>
                    <dd className="insights__summary-label">{descriptor.label}</dd>
                    <dd className="insights__summary-description">{descriptor.description}</dd>
                  </div>
                );
              })}
            </dl>
          )}
        </section>

        <section className="insights__panel" aria-labelledby="insights-renewal-timeline">
          <div className="insights__panel-header">
            <h3 id="insights-renewal-timeline">Renewal timeline</h3>
            <span className="insights__panel-subtitle">Monthly estimated renewal volume</span>
          </div>
          {timelinePoints.length === 0 ? (
            <p className="insights__empty">No estimated renewal timeline data yet.</p>
          ) : (
            <ol className="insights__timeline">
              {timelinePoints.map((point) => {
                const percentage = maxRenewalListings
                  ? Math.max(10, Math.round((point.listingCount / maxRenewalListings) * 100))
                  : 0;
                return (
                  <li key={point.renewalMonth.toISOString()} className="insights__timeline-item">
                    <div className="insights__timeline-label">
                      <span>{formatMonth(point.renewalMonth)}</span>
                      <span>{point.listingCount.toLocaleString()}</span>
                    </div>
                    <div className="insights__timeline-track">
                      <div className="insights__timeline-fill" style={{ width: `${percentage}%` }} />
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
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </section>
  );
}

export default ListingInsights;
