import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CachePayload } from '../types';

const isBrowser = typeof window !== 'undefined';

function loadFromStorage<T>(storageKey: string, version: number): CachePayload<T> {
  if (!isBrowser) {
    return { version, entries: {} };
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return { version, entries: {} };
    }
    const parsed = JSON.parse(raw) as CachePayload<T>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== version) {
      return { version, entries: {} };
    }
    return {
      version,
      entries: parsed.entries ?? {},
    };
  } catch (error) {
    console.warn('Unable to parse cached payload, starting fresh.', error);
    return { version, entries: {} };
  }
}

function persistToStorage<T>(storageKey: string, payload: CachePayload<T>) {
  if (!isBrowser) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to persist cache to storage.', error);
  }
}

export function usePersistentCache<T>(storageKey: string, version: number) {
  const [payload, setPayload] = useState<CachePayload<T>>(() => loadFromStorage<T>(storageKey, version));

  useEffect(() => {
    persistToStorage(storageKey, payload);
  }, [payload, storageKey]);

  useEffect(() => {
    if (payload.version !== version) {
      setPayload({ version, entries: {} });
    }
  }, [payload.version, version]);

  const getEntry = useCallback(
    (key: string): T | undefined => {
      return payload.entries[key];
    },
    [payload.entries]
  );

  const setEntry = useCallback(
    (key: string, value: T) => {
      setPayload((current) => ({
        version: current.version,
        entries: {
          ...current.entries,
          [key]: value,
        },
      }));
    },
    []
  );

  const removeEntry = useCallback((key: string) => {
    setPayload((current) => {
      if (!(key in current.entries)) {
        return current;
      }
      const { [key]: _omitted, ...rest } = current.entries;
      return {
        version: current.version,
        entries: rest,
      };
    });
  }, []);

  const clear = useCallback(() => {
    setPayload({ version, entries: {} });
  }, [version]);

  return useMemo(
    () => ({
      payload,
      getEntry,
      setEntry,
      removeEntry,
      clear,
    }),
    [payload, getEntry, setEntry, removeEntry, clear]
  );
}
