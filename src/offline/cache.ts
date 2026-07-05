import { db } from "./db";

/** Write-through cache of a Convex query result, keyed by a stable string. */
export async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    await db.cache.put({ key, value, updatedAt: Date.now() });
  } catch {
    // Cache is best-effort; never let it break the online path.
  }
}

export async function readCache<T>(key: string): Promise<T | undefined> {
  try {
    const row = await db.cache.get(key);
    return row?.value as T | undefined;
  } catch {
    return undefined;
  }
}
