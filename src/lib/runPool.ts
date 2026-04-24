/**
 * Run async work over `items` with at most `concurrency` workers in flight.
 * Order of completion is not guaranteed; all items are processed.
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;

  const runWorker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      await worker(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
}
