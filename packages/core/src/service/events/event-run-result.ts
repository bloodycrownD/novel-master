/**
 * 事件 action 链执行结果。
 *
 * @module service/events/event-run-result
 */

export interface EventActionFailure {
  readonly actionType: string;
  readonly error: string;
}

/**
 * 事件 action 链（串行或并行）的执行结果。
 *
 * @property partialFailure - 保留供未来并行 partial 语义；**当前实现恒为 false**（fail-fast 停止调度）。
 */
export interface EventRunResult {
  readonly ok: boolean;
  readonly partialFailure: boolean;
  readonly failures: readonly EventActionFailure[];
}