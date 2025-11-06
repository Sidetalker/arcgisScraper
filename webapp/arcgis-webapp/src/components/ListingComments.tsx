import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import {
  addListingComment,
  fetchListingComments,
  subscribeToListingComments,
  type ListingComment,
} from '@/services/listingComments';

interface ListingCommentsProps {
  listingId: string;
  heading?: string;
  sectionId: string;
}

function sortCommentsAscending(comments: ListingComment[]): ListingComment[] {
  return [...comments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export default function ListingComments({ listingId, heading, sectionId }: ListingCommentsProps) {
  const [comments, setComments] = useState<ListingComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const initialise = async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const initial = await fetchListingComments(listingId);
        if (!active) {
          return;
        }
        setComments(sortCommentsAscending(initial));

        unsubscribe = subscribeToListingComments(listingId, (comment) => {
          setComments((current) => {
            if (current.some((existing) => existing.id === comment.id)) {
              return current;
            }
            return sortCommentsAscending([...current, comment]);
          });
        });
      } catch (error) {
        if (!active) {
          return;
        }
        console.error('Unable to load comments for listing.', error);
        setLoadError(
          error instanceof Error ? error.message : 'Unable to load comments for this listing.',
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void initialise();

    return () => {
      active = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [listingId]);

  const formattedComments = useMemo(
    () =>
      comments.map((comment) => ({
        ...comment,
        formattedDate: comment.createdAt.toLocaleString(undefined, {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
      })),
    [comments],
  );

  const hasComments = formattedComments.length > 0;
  const canSubmit = newComment.trim().length > 0 && !saving && !loading && !loadError;

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSubmit) {
        return;
      }

      setSaving(true);
      setSubmitError(null);
      const payload = newComment.trim();

      try {
        const saved = await addListingComment(listingId, payload);
        setComments((current) => {
          if (current.some((existing) => existing.id === saved.id)) {
            return current;
          }
          return sortCommentsAscending([...current, saved]);
        });
        setNewComment('');
      } catch (error) {
        console.error('Unable to save listing comment.', error);
        setSubmitError(error instanceof Error ? error.message : 'Unable to save this comment.');
      } finally {
        setSaving(false);
      }
    },
    [canSubmit, listingId, newComment],
  );

  return (
    <section id={sectionId} className="listing-table__comments" aria-live="polite">
      <header className="listing-table__comments-header">
        <h3 className="listing-table__comments-title">Comments</h3>
        {heading ? <p className="listing-table__comments-heading">{heading}</p> : null}
      </header>

      {loading ? (
        <p className="listing-table__comments-status">Loading comments…</p>
      ) : loadError ? (
        <p className="listing-table__comments-error" role="alert">
          {loadError}
        </p>
      ) : hasComments ? (
        <ul className="listing-table__comments-list">
          {formattedComments.map((comment) => (
            <li key={comment.id} className="listing-table__comments-item">
              <p className="listing-table__comments-body">{comment.body}</p>
              <p className="listing-table__comments-timestamp">{comment.formattedDate}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="listing-table__comments-empty">No comments yet.</p>
      )}

      <form className="listing-table__comment-form" onSubmit={handleSubmit}>
        <label className="listing-table__comment-label" htmlFor={`${sectionId}-input`}>
          Add a comment
        </label>
        <textarea
          id={`${sectionId}-input`}
          className="listing-table__comment-input"
          value={newComment}
          onChange={(event) => setNewComment(event.target.value)}
          placeholder="Share a note about this property…"
          rows={3}
          disabled={loading || Boolean(loadError)}
        />
        <div className="listing-table__comment-actions">
          <button type="submit" className="listing-table__comment-submit" disabled={!canSubmit}>
            {saving ? 'Saving…' : 'Post comment'}
          </button>
        </div>
        {submitError ? (
          <p className="listing-table__comments-error" role="alert">
            {submitError}
          </p>
        ) : null}
      </form>
    </section>
  );
}
