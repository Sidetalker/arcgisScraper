import { assertSupabaseClient } from '@/services/supabaseClient';

interface WatchlistRow {
  id: string;
  name: string;
  created_at: string | null;
  updated_at: string | null;
}

interface WatchlistListingRow {
  watchlist_id: string;
  listing_id: string;
  created_at: string | null;
}

export interface WatchlistRecord {
  id: string;
  name: string;
  listingIds: string[];
  updatedAt: Date | null;
}

function normaliseTimestamp(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normaliseWatchlist(row: WatchlistRow, listingRows: WatchlistListingRow[]): WatchlistRecord {
  const listingIds: string[] = [];
  listingRows.forEach((listing) => {
    if (typeof listing?.listing_id === 'string' && listing.listing_id.trim().length > 0) {
      listingIds.push(listing.listing_id);
    }
  });

  return {
    id: row.id,
    name: row.name,
    listingIds,
    updatedAt: normaliseTimestamp(row.updated_at),
  };
}

export async function fetchWatchlists(): Promise<WatchlistRecord[]> {
  const client = assertSupabaseClient();

  const { data, error } = await client
    .from('watchlists')
    .select('id, name, updated_at, watchlist_listings(listing_id)')
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as unknown as Array<
    WatchlistRow & { watchlist_listings: WatchlistListingRow[] | null }
  >;

  return rows.map((row) => {
    const listings = Array.isArray(row.watchlist_listings) ? row.watchlist_listings : [];
    return normaliseWatchlist(row, listings);
  });
}

export async function createWatchlist(name: string): Promise<WatchlistRecord> {
  const client = assertSupabaseClient();
  const payload = { name };

  const { data, error } = await client
    .from('watchlists')
    .insert(payload)
    .select('id, name, updated_at')
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('Failed to create watchlist.');
  }

  const row = data as unknown as WatchlistRow;
  return normaliseWatchlist(row, []);
}

export async function renameWatchlist(watchlistId: string, name: string): Promise<WatchlistRecord> {
  const client = assertSupabaseClient();
  const { data, error } = await client
    .from('watchlists')
    .update({ name })
    .eq('id', watchlistId)
    .select('id, name, updated_at')
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('Failed to rename watchlist.');
  }

  const row = data as unknown as WatchlistRow;
  return normaliseWatchlist(row, []);
}

export async function addListingToWatchlist(
  watchlistId: string,
  listingId: string,
): Promise<void> {
  const client = assertSupabaseClient();
  const payload = { watchlist_id: watchlistId, listing_id: listingId };
  const { error } = await client.from('watchlist_listings').upsert(payload);

  if (error) {
    throw error;
  }
}

export async function removeListingFromWatchlist(
  watchlistId: string,
  listingId: string,
): Promise<void> {
  const client = assertSupabaseClient();
  const { error } = await client
    .from('watchlist_listings')
    .delete()
    .eq('watchlist_id', watchlistId)
    .eq('listing_id', listingId);

  if (error) {
    throw error;
  }
}

export async function replaceWatchlistListings(
  watchlistId: string,
  listingIds: string[],
): Promise<void> {
  const client = assertSupabaseClient();

  const { data, error } = await client
    .from('watchlist_listings')
    .select('listing_id')
    .eq('watchlist_id', watchlistId);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as unknown as WatchlistListingRow[];
  const existingIds = new Set(
    rows
      .map((row) => (typeof row?.listing_id === 'string' ? row.listing_id : null))
      .filter((id): id is string => Boolean(id)),
  );

  const targetIds = new Set(listingIds);

  const idsToAdd: string[] = [];
  targetIds.forEach((id) => {
    if (!existingIds.has(id)) {
      idsToAdd.push(id);
    }
  });

  const idsToRemove: string[] = [];
  existingIds.forEach((id) => {
    if (!targetIds.has(id)) {
      idsToRemove.push(id);
    }
  });

  if (idsToRemove.length > 0) {
    const { error: deleteError } = await client
      .from('watchlist_listings')
      .delete()
      .eq('watchlist_id', watchlistId)
      .in('listing_id', idsToRemove);

    if (deleteError) {
      throw deleteError;
    }
  }

  if (idsToAdd.length > 0) {
    const rowsToInsert = idsToAdd.map((id) => ({ watchlist_id: watchlistId, listing_id: id }));
    const { error: insertError } = await client.from('watchlist_listings').insert(rowsToInsert);
    if (insertError) {
      throw insertError;
    }
  }
}

export async function deleteWatchlist(watchlistId: string): Promise<void> {
  const client = assertSupabaseClient();
  const { error } = await client.from('watchlists').delete().eq('id', watchlistId);
  if (error) {
    throw error;
  }
}
