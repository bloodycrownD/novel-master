/**
 * FIFO 异步互斥：把并发调用串到一条 Promise 链上。
 *
 * 两个 SQLite 驱动共用（better-sqlite3 的同步 API、op-sqlite 的单连接）。
 *
 * @module infra/tdbc/logic/async-mutex
 */

/** 每个 {@link AsyncMutex.run} 都等前一个任务 settle 后才开始。 */
export class AsyncMutex {
    private tail: Promise<void> = Promise.resolve();

    /** 入队 `fn` 并返回它的结果。 */
    run<T>(fn: () => T | Promise<T>): Promise<T> {
        const result = this.tail.then(() => fn());
        this.tail = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }
}
