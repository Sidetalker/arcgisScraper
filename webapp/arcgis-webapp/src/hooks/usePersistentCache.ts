import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type DependencyValue = string | number | boolean | null | undefined;

interface StoredEntry<T> {
  value: T;
  expiresAt: number | null;
  dependencies: DependencyValue[];
  storedAt: number;
}

export interface CacheEntrySnapshot<T = unknown> extends StoredEntry<T> {
  key: string;
  storageKey: string;
}

export interface CacheGetOptions {
  dependencies?: readonly DependencyValue[];
}

export interface CacheSetOptions {
  dependencies?: readonly DependencyValue[];
  ttl?: number;
}

const STORAGE_PREFIX = 'arcgis-cache:';
const KEY_SEPARATOR = '::deps::';

function isStorageAvailable(): Storage | undefined {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return undefined;
  }

  try {
    const testKey = `${STORAGE_PREFIX}__test__`;
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch (error) {
    console.warn('Persistent cache is disabled because localStorage is unavailable.', error);
    return undefined;
  }
}

function normaliseDependencies(dependencies: readonly DependencyValue[] = []): DependencyValue[] {
  return [...dependencies];
}

function encodeKeyPart(part: string): string {
  return encodeURIComponent(part);
}

function decodeKeyPart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function buildStorageKey(key: string, dependencies: readonly DependencyValue[] = []): string {
  const encodedKey = encodeKeyPart(key);
  const encodedDependencies = encodeKeyPart(JSON.stringify(dependencies ?? []));
  return `${STORAGE_PREFIX}${encodedKey}${KEY_SEPARATOR}${encodedDependencies}`;
}

function parseStorageKey(storageKey: string): { key: string; dependencies: DependencyValue[] } | undefined {
  if (!storageKey.startsWith(STORAGE_PREFIX)) {
    return undefined;
  }

  const trimmed = storageKey.slice(STORAGE_PREFIX.length);
  const [encodedKey, encodedDependencies] = trimmed.split(KEY_SEPARATOR);

  if (!encodedKey) {
    return undefined;
  }

  const key = decodeKeyPart(encodedKey);
  const dependenciesPart = encodedDependencies ? decodeKeyPart(encodedDependencies) : '[]';

  try {
    const dependencies = JSON.parse(dependenciesPart) as DependencyValue[];
    return { key, dependencies };
  } catch {
    return { key, dependencies: [] };
  }
}

function readStoredEntry<T>(storage: Storage, storageKey: string): StoredEntry<T> | undefined {
  const raw = storage.getItem(storageKey);
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as StoredEntry<T>;
    if (typeof parsed !== 'object' || parsed === null || !('value' in parsed)) {
      throw new Error('Invalid cache entry shape');
    }

    return parsed;
  } catch {
    storage.removeItem(storageKey);
    return undefined;
  }
}

function readAllEntries(storage: Storage): CacheEntrySnapshot[] {
  const snapshots: CacheEntrySnapshot[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const storageKey = storage.key(index);
    if (!storageKey || !storageKey.startsWith(STORAGE_PREFIX)) {
      continue;
    }

    const parsedKey = parseStorageKey(storageKey);
    if (!parsedKey) {
      continue;
    }

    const entry = readStoredEntry(storage, storageKey);
    if (!entry) {
      continue;
    }

    const { expiresAt } = entry;
    if (typeof expiresAt === 'number' && expiresAt > 0 && expiresAt <= Date.now()) {
      storage.removeItem(storageKey);
      continue;
    }

    const dependencies = Array.isArray(entry.dependencies) ? entry.dependencies : [];
    const storedAt = typeof entry.storedAt === 'number' ? entry.storedAt : Date.now();

    snapshots.push({
      key: parsedKey.key,
      dependencies,
      value: entry.value,
      expiresAt: entry.expiresAt ?? null,
      storedAt,
      storageKey,
    });
  }

  return snapshots;
}

export interface PersistentCacheApi {
  entries: CacheEntrySnapshot[];
  get: <T>(key: string, options?: CacheGetOptions) => T | undefined;
  set: <T>(key: string, value: T, options?: CacheSetOptions) => void;
  clear: (key?: string, options?: CacheGetOptions) => void;
}

export function usePersistentCache(): PersistentCacheApi {
  const storageRef = useRef<Storage | undefined>(undefined);
  if (!storageRef.current) {
    storageRef.current = isStorageAvailable();
  }

  const [version, setVersion] = useState(0);

  const notifyChange = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    const storage = storageRef.current;
    if (!storage || typeof window === 'undefined') {
      return undefined;
    }

    const handleStorage = (event: StorageEvent): void => {
      if (event.storageArea !== storage) {
        return;
      }

      if (event.key && !event.key.startsWith(STORAGE_PREFIX)) {
        return;
      }

      notifyChange();
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [notifyChange]);

  const get = useCallback(<TValue,>(key: string, options?: CacheGetOptions) => {
    const storage = storageRef.current;
    if (!storage) {
      return undefined;
    }

    const dependencies = normaliseDependencies(options?.dependencies);
    const storageKey = buildStorageKey(key, dependencies);
    const entry = readStoredEntry(storage, storageKey);
    if (!entry) {
      return undefined;
    }

    const expiresAt = entry.expiresAt ?? null;
    if (typeof expiresAt === 'number' && expiresAt > 0 && expiresAt <= Date.now()) {
      storage.removeItem(storageKey);
      notifyChange();
      return undefined;
    }

    return entry.value as TValue;
  }, [notifyChange]);

  const set = useCallback(<TValue,>(
    key: string,
    value: TValue,
    options?: CacheSetOptions,
  ) => {
    const storage = storageRef.current;
    if (!storage) {
      return;
    }

    const dependencies = normaliseDependencies(options?.dependencies);
    const storageKey = buildStorageKey(key, dependencies);
    const ttl = options?.ttl ?? null;
    const expiresAt = typeof ttl === 'number' && ttl > 0 ? Date.now() + ttl : null;

    const entry: StoredEntry<unknown> = {
      value,
      dependencies,
      storedAt: Date.now(),
      expiresAt,
    };

    try {
      storage.setItem(storageKey, JSON.stringify(entry));
      notifyChange();
    } catch (error) {
      console.warn(`Unable to persist cache entry for key "${key}".`, error);
    }
  }, [notifyChange]);

  const clear = useCallback<PersistentCacheApi['clear']>((key, options) => {
    const storage = storageRef.current;
    if (!storage) {
      return;
    }

    const keysToRemove: string[] = [];

    if (!key) {
      for (let index = 0; index < storage.length; index += 1) {
        const storageKey = storage.key(index);
        if (storageKey && storageKey.startsWith(STORAGE_PREFIX)) {
          keysToRemove.push(storageKey);
        }
      }
    } else if (options?.dependencies) {
      const dependencies = normaliseDependencies(options.dependencies);
      keysToRemove.push(buildStorageKey(key, dependencies));
    } else {
      for (let index = 0; index < storage.length; index += 1) {
        const storageKey = storage.key(index);
        if (!storageKey || !storageKey.startsWith(STORAGE_PREFIX)) {
          continue;
        }

        const parsedKey = parseStorageKey(storageKey);
        if (parsedKey?.key === key) {
          keysToRemove.push(storageKey);
        }
      }
    }

    if (!keysToRemove.length) {
      return;
    }

    keysToRemove.forEach((storageKey) => storage.removeItem(storageKey));
    notifyChange();
  }, [notifyChange]);

  const entries = useMemo(() => {
    const storage = storageRef.current;
    if (!storage) {
      return [] as CacheEntrySnapshot[];
    }

    return readAllEntries(storage);
  }, [version]);

  return useMemo<PersistentCacheApi>(
    () => ({
      entries,
      get: get as PersistentCacheApi['get'],
      set: set as PersistentCacheApi['set'],
      clear,
    }),
    [entries, get, set, clear],
  );
}

export default usePersistentCache;
