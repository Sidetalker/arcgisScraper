export type ListingSyncStatus = 'success' | 'error';

export interface ListingSyncEventRow {
  id: string;
  triggered_by: string;
  status: ListingSyncStatus;
  started_at: string;
  completed_at: string | null;
  previous_total: number | null;
  current_total: number | null;
  added_count: number | null;
  removed_count: number | null;
  updated_count: number | null;
  error_message: string | null;
  created_at: string;
}

export interface ListingSyncEvent {
  id: string;
  triggeredBy: string;
  status: ListingSyncStatus;
  startedAt: Date;
  completedAt: Date | null;
  previousTotal: number | null;
  currentTotal: number | null;
  addedCount: number | null;
  removedCount: number | null;
  updatedCount: number | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface CreateListingSyncEventInput {
  triggeredBy: string;
  status: ListingSyncStatus;
  startedAt: Date;
  completedAt: Date | null;
  previousTotal?: number | null;
  currentTotal?: number | null;
  addedCount?: number | null;
  removedCount?: number | null;
  updatedCount?: number | null;
  errorMessage?: string | null;
}

function toRow(input: CreateListingSyncEventInput): Omit<ListingSyncEventRow, 'id' | 'created_at'> {
  return {
    triggered_by: input.triggeredBy,
    status: input.status,
    started_at: input.startedAt.toISOString(),
    completed_at: input.completedAt ? input.completedAt.toISOString() : null,
    previous_total: input.previousTotal ?? null,
    current_total: input.currentTotal ?? null,
    added_count: input.addedCount ?? null,
    removed_count: input.removedCount ?? null,
    updated_count: input.updatedCount ?? null,
    error_message: input.errorMessage ?? null,
  };
}

function fromRow(row: ListingSyncEventRow): ListingSyncEvent {
  return {
    id: row.id,
    triggeredBy: row.triggered_by,
    status: row.status,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    previousTotal: row.previous_total,
    currentTotal: row.current_total,
    addedCount: row.added_count,
    removedCount: row.removed_count,
    updatedCount: row.updated_count,
    errorMessage: row.error_message,
    createdAt: new Date(row.created_at),
  };
}

type SupabaseClientLike = any;

async function getClient(
  clientOverride?: SupabaseClientLike,
): Promise<SupabaseClientLike> {
  if (clientOverride) {
    return clientOverride;
  }

  const module = await import('./supabaseClient');
  return module.assertSupabaseClient();
}

export async function insertListingSyncEvent(
  input: CreateListingSyncEventInput,
  clientOverride?: SupabaseClientLike,
): Promise<ListingSyncEvent> {
  const client = await getClient(clientOverride);
  const { data, error } = await client
    .from('listing_sync_events')
    .insert(toRow(input))
    .select()
    .single();

  if (error) {
    throw error;
  }

  return fromRow(data as ListingSyncEventRow);
}

export async function fetchRecentListingSyncEvents(
  options?: { limit?: number },
  clientOverride?: SupabaseClientLike,
): Promise<ListingSyncEvent[]> {
  const client = await getClient(clientOverride);
  const limit = options?.limit ?? 10;
  const { data, error } = await client
    .from('listing_sync_events')
    .select()
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as ListingSyncEventRow[];
  return rows.map((row) => fromRow(row));
}
