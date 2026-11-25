/** Bounded, coalesced snapshots with optional stale-while-revalidate. Invalidated in-flight results cannot refill the cache. */
interface SnapshotCacheEntry<T> {
  promise: Promise<T>;
  expiresAt: number;
  staleUntil: number;
  settled: boolean;
  revalidating: boolean;
  generation: number;
}

export function createAsyncSnapshotCache<T>(ttlMs: number, capacity = 32, staleWhileRevalidateMs = 0) {
  const entries = new Map<string, SnapshotCacheEntry<T>>();
  let generation = 0;

  return {
    peek(key: string): Promise<T> | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (!entry.settled || entry.expiresAt > Date.now()) return entry.promise;
      return undefined;
    },
    get(key: string, load: () => Promise<T>, force = false): Promise<T> {
      const now = Date.now();
      const previous = entries.get(key);
      if (previous && !force) {
        if (!previous.settled || previous.expiresAt > now) return previous.promise;
        if (staleWhileRevalidateMs > 0 && previous.settled && previous.staleUntil > now) {
          if (!previous.revalidating) {
            previous.revalidating = true;
            const reqGen = generation;
            void Promise.resolve().then(load).then(
              (value) => {
                if (generation === reqGen && entries.get(key) === previous) {
                  const freshAt = Date.now();
                  const freshExpiresAt = freshAt + ttlMs;
                  entries.set(key, {
                    promise: Promise.resolve(value),
                    expiresAt: freshExpiresAt,
                    staleUntil: freshExpiresAt + staleWhileRevalidateMs,
                    settled: true,
                    revalidating: false,
                    generation: reqGen,
                  });
                }
              },
              () => {
                if (entries.get(key) === previous) previous.revalidating = false;
              },
            );
          }
          return previous.promise;
        }
      }

      const entryGeneration = generation;
      const entry: SnapshotCacheEntry<T> = {
        promise: Promise.resolve().then(load),
        expiresAt: Infinity,
        staleUntil: Infinity,
        settled: false,
        revalidating: false,
        generation: entryGeneration,
      };
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > capacity) entries.delete(entries.keys().next().value!);
      void entry.promise.then(
        () => {
          if (generation === entryGeneration && entries.get(key) === entry) {
            const settledAt = Date.now();
            entry.settled = true;
            entry.expiresAt = settledAt + ttlMs;
            entry.staleUntil = entry.expiresAt + staleWhileRevalidateMs;
          }
        },
        () => {
          if (entries.get(key) === entry) entries.delete(key);
        },
      );
      return entry.promise;
    },
    invalidate() {
      generation += 1;
      entries.clear();
    },
  };
}
