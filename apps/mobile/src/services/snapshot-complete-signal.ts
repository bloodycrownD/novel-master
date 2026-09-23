/**
 * 快照完成一次性信号（rollback-large-jank Step 5）。
 *
 * 用途：把「ChatTranscriptWebView 的快照末片 post + deferred actions 排空」
 * 这个 webview 组件内部时点外提给回滚链——runRollback 在 reloadMessages
 * 之后等待该信号，收到才发起 token 全量重算（第三遍 parse 错峰到快照
 * post 完成之后）；信号迟到给超时兜底（token 刷新最终仍执行，只是回到
 * 现状时机，不悬挂）。
 *
 * 语义为「单次信号盒」：
 * - notify：有人在等 → 立即放行；无人等 → 记一次 pending（下一次
 *   consumeNext 立即返回；再多的 notify 覆盖同一 pending，不累积）；
 * - consumeNext：pending 已有 → 立即 resolve；否则挂起等待下一次
 *   notify，至多等 timeoutMs（超时 resolve 'timeout'，等待者作废，
 *   后到的 notify 留作下一个 consumeNext 的 pending）。
 *
 * @module services/snapshot-complete-signal
 */

/** 快照完成信号盒：webview 侧 notify，回滚链侧 consumeNext。 */
export interface SnapshotCompleteSignal {
  /** 快照全部片 post 且 deferred actions 排空后调用（组件侧）。 */
  notify(): void;
  /**
   * 等待下一次快照完成信号。
   *
   * @returns 'signaled'（等到了信号）或 'timeout'（超时兜底）。
   */
  consumeNext(timeoutMs: number): Promise<'signaled' | 'timeout'>;
}

export function createSnapshotCompleteSignal(): SnapshotCompleteSignal {
  let waiting: (() => void) | null = null;
  let pending = false;
  return {
    notify() {
      if (waiting != null) {
        const resolve = waiting;
        waiting = null;
        resolve();
        return;
      }
      pending = true;
    },
    consumeNext(timeoutMs: number): Promise<'signaled' | 'timeout'> {
      return new Promise(resolve => {
        if (pending) {
          pending = false;
          resolve('signaled');
          return;
        }
        const timer = setTimeout(() => {
          if (waiting != null) {
            waiting = null;
            resolve('timeout');
          }
        }, timeoutMs);
        waiting = () => {
          clearTimeout(timer);
          resolve('signaled');
        };
      });
    },
  };
}
