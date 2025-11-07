import { assertSupabaseClient } from '@/services/supabaseClient';

export interface ListingCommentRow {
  id: string;
  listing_id: string;
  body: string;
  created_at: string;
}

export interface ListingComment {
  id: string;
  listingId: string;
  body: string;
  createdAt: Date;
}

function mapRowToComment(row: ListingCommentRow): ListingComment {
  return {
    id: row.id,
    listingId: row.listing_id,
    body: row.body ?? '',
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
  };
}

export async function fetchListingComments(listingId: string): Promise<ListingComment[]> {
  const supabase = assertSupabaseClient();
  const { data, error } = await supabase
    .from('listing_comments')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message ?? 'Failed to load listing comments.');
  }

  return (data ?? []).map((row) => mapRowToComment(row as ListingCommentRow));
}

export async function addListingComment(listingId: string, body: string): Promise<ListingComment> {
  const supabase = assertSupabaseClient();
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error('Comment cannot be empty.');
  }

  const { data, error } = await supabase
    .from('listing_comments')
    .insert({ listing_id: listingId, body: trimmed })
    .select()
    .single();

  if (error) {
    throw new Error(error.message ?? 'Failed to save the comment.');
  }

  return mapRowToComment(data as ListingCommentRow);
}

export async function deleteListingComment(commentId: string): Promise<void> {
  const supabase = assertSupabaseClient();
  const { error } = await supabase.from('listing_comments').delete().eq('id', commentId);

  if (error) {
    throw new Error(error.message ?? 'Failed to delete the comment.');
  }
}

interface ListingCommentSubscriptionHandlers {
  onInsert?: (comment: ListingComment) => void;
  onDelete?: (comment: ListingComment) => void;
}

export function subscribeToListingComments(
  listingId: string,
  handlers: ListingCommentSubscriptionHandlers = {},
): () => void {
  const { onInsert, onDelete } = handlers;
  const supabase = assertSupabaseClient();
  const channel = supabase.channel(`listing-comments:${listingId}`);

  channel.on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'listing_comments',
      filter: `listing_id=eq.${listingId}`,
    },
    (payload) => {
      if (!onInsert) {
        return;
      }
      const row = payload.new as ListingCommentRow;
      onInsert(mapRowToComment(row));
    },
  );

  channel.on(
    'postgres_changes',
    {
      event: 'DELETE',
      schema: 'public',
      table: 'listing_comments',
      filter: `listing_id=eq.${listingId}`,
    },
    (payload) => {
      if (!onDelete) {
        return;
      }
      const row = payload.old as ListingCommentRow;
      onDelete(mapRowToComment(row));
    },
  );

  channel.subscribe((status, error) => {
    if (status === 'CHANNEL_ERROR') {
      console.error('Failed to subscribe to listing comments channel.', error);
    }
  });

  return () => {
    void channel.unsubscribe();
  };
}

export async function fetchListingCommentCounts(
  listingIds: readonly string[],
): Promise<Record<string, number>> {
  if (listingIds.length === 0) {
    return {};
  }

  const supabase = assertSupabaseClient();
  const { data, error } = await supabase
    .from('listing_comments')
    .select('listing_id')
    .in('listing_id', listingIds);

  if (error) {
    throw new Error(error.message ?? 'Failed to load listing comment counts.');
  }

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const listingId = (row as Pick<ListingCommentRow, 'listing_id'>).listing_id;
    if (!listingId) {
      continue;
    }
    counts[listingId] = (counts[listingId] ?? 0) + 1;
  }

  return counts;
}
