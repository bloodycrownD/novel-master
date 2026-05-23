/**
 * Serializes async callers onto a single chain (better-sqlite3 is synchronous).
 *
 * @module tdbc-driver-better-sqlite3/mutex
 */

/**
 * FIFO mutex: each {@link run} waits for the previous task to settle.
 */
export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Enqueues `fn` and returns its result.
   */
  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(() => fn());
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
