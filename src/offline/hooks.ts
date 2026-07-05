import { useEffect, useState } from "react";
import { isOnline, onNetworkChange, initNetwork } from "../native/network";
import { getSyncStatus, onSyncStatus, type SyncStatus } from "./syncManager";
import { readCache, writeCache } from "./cache";

/** Live connectivity flag (native + web). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline());
  useEffect(() => {
    initNetwork();
    return onNetworkChange(setOnline);
  }, []);
  return online;
}

/** Sync engine status (pending counts, syncing, last error). */
export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>(getSyncStatus());
  useEffect(() => onSyncStatus(setS), []);
  return s;
}

export interface CachedQueryResult<T> {
  data: T | undefined;
  /** True when the value came from the offline cache, not a live query. */
  fromCache: boolean;
  loading: boolean;
}

/**
 * Wrap a Convex `useQuery` result with an offline fallback. When the live query
 * has data, it is returned and written through to the cache. When it is
 * undefined (offline or first load), the last cached value is returned so the
 * inspector can keep browsing with no signal.
 */
export function useCachedQuery<T>(key: string, liveData: T | undefined): CachedQueryResult<T> {
  const [cached, setCached] = useState<T | undefined>(undefined);
  const [checkedCache, setCheckedCache] = useState(false);

  useEffect(() => {
    if (liveData !== undefined) {
      setCached(liveData);
      setCheckedCache(true);
      void writeCache(key, liveData);
      return;
    }
    let active = true;
    void readCache<T>(key).then((v) => {
      if (!active) return;
      setCached(v);
      setCheckedCache(true);
    });
    return () => {
      active = false;
    };
  }, [key, liveData]);

  const data = liveData !== undefined ? liveData : cached;
  const fromCache = liveData === undefined && cached !== undefined;
  const loading = data === undefined && !checkedCache;
  return { data, fromCache, loading };
}
