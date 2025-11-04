import { fetchListings } from '../services/arcgisClient';
import { toListingRecord } from '../services/listingTransformer';
import type { ListingRecord } from '../types';
import type { ListingSyncEvent, CreateListingSyncEventInput } from '../services/listingSyncEvents';

export type ListingSyncTrigger = 'manual' | 'scheduled';

export interface ListingSnapshot {
  records: ListingRecord[];
  latestUpdatedAt: Date | null;
}

export interface ListingSyncSummary {
  startedAt: Date;
  completedAt: Date;
  previousTotal: number;
  currentTotal: number;
  addedCount: number;
  removedCount: number;
  updatedCount: number;
}

export interface ListingSyncResult {
  records: ListingRecord[];
  snapshot: ListingSnapshot;
  summary: ListingSyncSummary;
  event: ListingSyncEvent;
}

export interface ListingSyncDependencies {
  loadSnapshot: () => Promise<ListingSnapshot>;
  replaceAll: (records: ListingRecord[]) => Promise<void>;
  recordEvent: (input: CreateListingSyncEventInput) => Promise<ListingSyncEvent>;
}

function stableStringify(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  const type = typeof value;
  if (type === 'undefined') {
    return 'undefined';
  }

  if (type === 'number' || type === 'boolean') {
    return String(value);
  }

  if (type === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
    .join(',')}}`;
}

function normaliseForDiff(record: ListingRecord): string {
  return stableStringify(record);
}

export async function syncListingsFromArcgis(
  trigger: ListingSyncTrigger,
  dependencies: ListingSyncDependencies,
): Promise<ListingSyncResult> {
  const startedAt = new Date();
  let snapshot: ListingSnapshot = { records: [], latestUpdatedAt: null };

  try {
    snapshot = await dependencies.loadSnapshot();

    const featureSet = await fetchListings({
      filters: { returnGeometry: true },
      useCache: false,
    });

    const features = featureSet.features ?? [];
    const seen = new Set<string>();
    const records: ListingRecord[] = [];
    features.forEach((feature, index) => {
      const record = toListingRecord(feature, index);
      if (seen.has(record.id)) {
        return;
      }
      seen.add(record.id);
      records.push(record);
    });

    const previousMap = new Map(snapshot.records.map((record) => [record.id, record]));
    const nextMap = new Map(records.map((record) => [record.id, record]));

    let addedCount = 0;
    let removedCount = 0;
    let updatedCount = 0;

    records.forEach((record) => {
      const previous = previousMap.get(record.id);
      if (!previous) {
        addedCount += 1;
        return;
      }

      if (normaliseForDiff(previous) !== normaliseForDiff(record)) {
        updatedCount += 1;
      }
    });

    snapshot.records.forEach((record) => {
      if (!nextMap.has(record.id)) {
        removedCount += 1;
      }
    });

    await dependencies.replaceAll(records);

    const completedAt = new Date();
    const event = await dependencies.recordEvent({
      triggeredBy: trigger,
      status: 'success',
      startedAt,
      completedAt,
      previousTotal: snapshot.records.length,
      currentTotal: records.length,
      addedCount,
      removedCount,
      updatedCount,
    });

    return {
      records,
      snapshot,
      summary: {
        startedAt,
        completedAt,
        previousTotal: snapshot.records.length,
        currentTotal: records.length,
        addedCount,
        removedCount,
        updatedCount,
      },
      event,
    };
  } catch (error) {
    const completedAt = new Date();
    try {
      await dependencies.recordEvent({
        triggeredBy: trigger,
        status: 'error',
        startedAt,
        completedAt,
        previousTotal: snapshot.records.length,
        currentTotal: snapshot.records.length,
        addedCount: null,
        removedCount: null,
        updatedCount: null,
        errorMessage: error instanceof Error ? error.message : 'Unknown sync failure',
      });
    } catch (recordError) {
      console.error('Failed to record sync failure event.', recordError);
    }

    throw error;
  }
}
