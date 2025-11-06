import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  sharePath: string;
  highlightCommentId?: string | null;
  onCommentSummaryChange?: (
    summary: { listingId: string; count: number; hasComments: boolean },
  ) => void;
}

function sortCommentsAscending(comments: ListingComment[]): ListingComment[] {
  return [...comments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export default function ListingComments({
  listingId,
  heading,
  sectionId,
  sharePath,
  highlightCommentId,
  onCommentSummaryChange,
}: ListingCommentsProps) {
  const [comments, setComments] = useState<ListingComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [copiedCommentId, setCopiedCommentId] = useState<string | null>(null);
  const [copyAnnouncement, setCopyAnnouncement] = useState<string | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const commentRefs = useRef<Map<string, HTMLLIElement | null>>(new Map());
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);

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

  const commentCount = comments.length;
  const hasComments = commentCount > 0;
  const canSubmit = newComment.trim().length > 0 && !saving && !loading && !loadError;

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!onCommentSummaryChange) {
      return;
    }

    onCommentSummaryChange({ listingId, count: commentCount, hasComments: commentCount > 0 });
  }, [commentCount, listingId, onCommentSummaryChange]);

  const registerComment = useCallback((id: string) => (element: HTMLLIElement | null) => {
    if (element) {
      commentRefs.current.set(id, element);
    } else {
      commentRefs.current.delete(id);
    }
  }, []);

  const buildCommentLink = useCallback(
    (commentId: string) => {
      const params = new URLSearchParams();
      params.set('listing', listingId);
      params.set('comment', commentId);

      if (typeof window === 'undefined') {
        const path = sharePath.startsWith('/') ? sharePath : `/${sharePath}`;
        return `${path}?${params.toString()}`;
      }

      const url = new URL(window.location.href);
      url.pathname = sharePath.startsWith('/') ? sharePath : `/${sharePath}`;
      url.search = params.toString();
      url.hash = '';
      return url.toString();
    },
    [listingId, sharePath],
  );

  const handleCopyLink = useCallback(
    async (commentId: string) => {
      if (typeof window === 'undefined') {
        return;
      }

      const link = buildCommentLink(commentId);
      let copied = false;

      try {
        const clipboard = window.navigator?.clipboard;
        if (clipboard && typeof clipboard.writeText === 'function') {
          await clipboard.writeText(link);
          copied = true;
        }
      } catch (error) {
        console.warn('Failed to copy comment link via clipboard API.', error);
      }

      if (!copied) {
        const result = window.prompt('Copy this comment link:', link);
        if (result === null) {
          return;
        }
        copied = true;
      }

      if (!copied) {
        return;
      }

      setCopiedCommentId(commentId);
      setCopyAnnouncement('Comment link copied to clipboard.');

      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }

      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCopiedCommentId((current) => (current === commentId ? null : current));
        setCopyAnnouncement(null);
      }, 2500);
    },
    [buildCommentLink],
  );

  useEffect(() => {
    if (!highlightCommentId) {
      setActiveHighlightId(null);
      return;
    }

    const hasComment = comments.some((comment) => comment.id === highlightCommentId);
    if (!hasComment) {
      return;
    }

    setActiveHighlightId(highlightCommentId);

    if (typeof window === 'undefined') {
      return;
    }

    const targetElement = commentRefs.current.get(highlightCommentId);
    if (targetElement && typeof targetElement.scrollIntoView === 'function') {
      targetElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    const timeoutId = window.setTimeout(() => {
      setActiveHighlightId((current) => (current === highlightCommentId ? null : current));
    }, 4000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [highlightCommentId, comments]);

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
        <>
          <ul className="listing-table__comments-list">
            {formattedComments.map((comment) => {
              const isHighlighted = activeHighlightId === comment.id;
              const isCopied = copiedCommentId === comment.id;
              const itemClassName = [
                'listing-table__comments-item',
                isHighlighted ? 'listing-table__comments-item--highlight' : '',
                isCopied ? 'listing-table__comments-item--copied' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <li
                  key={comment.id}
                  ref={registerComment(comment.id)}
                  className={itemClassName}
                  data-highlight={isHighlighted ? 'true' : undefined}
                >
                  <p className="listing-table__comments-body">{comment.body}</p>
                  <div className="listing-table__comments-meta">
                    <p className="listing-table__comments-timestamp">{comment.formattedDate}</p>
                    <button
                      type="button"
                      className="listing-table__comments-share"
                      onClick={() => handleCopyLink(comment.id)}
                    >
                      {isCopied ? 'Link copied!' : 'Copy link'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="listing-table__sr-only" aria-live="polite">
            {copyAnnouncement ?? ''}
          </p>
        </>
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
