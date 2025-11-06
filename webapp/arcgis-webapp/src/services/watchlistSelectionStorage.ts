const STORAGE_KEY = 'arcgis-watchlist-selection:v1';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadSelectedWatchlistId(): string | null {
  if (!isBrowser()) {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(STORAGE_KEY);
    if (!storedValue) {
      return null;
    }
    const trimmed = storedValue.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    console.warn('Failed to read stored watchlist selection.', error);
    return null;
  }
}

export function saveSelectedWatchlistId(id: string | null): void {
  if (!isBrowser()) {
    return;
  }

  try {
    if (id && id.trim().length > 0) {
      window.localStorage.setItem(STORAGE_KEY, id);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Failed to persist watchlist selection.', error);
  }
}
