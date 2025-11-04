import { createContext, ReactNode, useContext } from 'react';

import usePersistentCache, { PersistentCacheApi } from '@/hooks/usePersistentCache';

export type CacheContextValue = PersistentCacheApi;

const CacheContext = createContext<CacheContextValue | undefined>(undefined);

export function CacheProvider({ children }: { children: ReactNode }): JSX.Element {
  const cache = usePersistentCache();

  return <CacheContext.Provider value={cache}>{children}</CacheContext.Provider>;
}

export function useCache(): CacheContextValue {
  const context = useContext(CacheContext);
  if (!context) {
    throw new Error('useCache must be used within a CacheProvider');
  }

  return context;
}

export type {
  CacheEntrySnapshot,
  CacheGetOptions,
  CacheSetOptions,
  DependencyValue,
} from '@/hooks/usePersistentCache';
