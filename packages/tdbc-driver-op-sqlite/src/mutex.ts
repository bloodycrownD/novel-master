/**
 * 串行化同一连接上的并发 async 调用。
 *
 * @module tdbc-driver-op-sqlite/mutex
 */

export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(() => fn());
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
