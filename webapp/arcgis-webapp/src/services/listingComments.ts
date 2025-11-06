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

export function subscribeToListingComments(
  listingId: string,
  onInsert: (comment: ListingComment) => void,
): () => void {
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
      const row = payload.new as ListingCommentRow;
      onInsert(mapRowToComment(row));
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
