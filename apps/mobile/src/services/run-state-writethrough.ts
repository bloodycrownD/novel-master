/**
 * 会话 run 状态写通 coalescer（`session_run_state` 表的节流写入口）。
 *
 * 三态形态参照 sse-chunk-emitter（append / flush / dispose）：
 * - `append(state)`：全量快照式暂存（多次 append 只保留最新一份，天然合并），
 *   并按需调度定时写——正常档 250ms；单次载荷超过阈值（约 1MB，按字符数
 *   近似）时降频到 1s，防大 partial 高频全量覆盖造成的写放大；
 * - `flush()`：取消定时器并立即发起写（同步发起、异步完成；写失败吞错留
 *   日志，不外抛）。step 边界 / 单元替换 / manager dispose 前的「尽力
 *   落盘」都走这里；
 * - `dispose()`：取消定时器并丢弃未写数据，此后 append/flush 均为 no-op
 *   （僵尸写防御——被替换的旧 run 不得再覆盖新 run 的行）。
 *
 * 写的发起顺序即同步调用顺序：flush 内部同步调用 write，调用方「先 flush
 * 旧 coalescer、后建新单元」即可保证旧写先于新写发起（底层 SQLite 单写者
 * 按发起序串行执行）。
 *
 * @module services/run-state-writethrough
 */
import type {SessionRunState} from '@novel-master/core/session-run-state';

/** 正常合并窗口（毫秒）：窗口内多次 append 只产生一次写。 */
export const RUN_STATE_WRITETHROUGH_INTERVAL_MS = 250;

/** 大载荷降频档（毫秒）：单次载荷超阈值时改用本间隔。 */
export const RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS = 1_000;

/**
 * 大载荷阈值（字符数近似 1MB）：partial 全量覆盖写下，行体积主要由
 * partial_text/partial_thinking 贡献，按字符量估算足以触发降频。
 */
export const RUN_STATE_WRITETHROUGH_LARGE_PAYLOAD_CHARS = 1_000_000;

/** 实际落库函数（manager 注入 runState 服务的 upsert 窄口）。 */
export type RunStateWritethroughWriteFn = (state: SessionRunState) => Promise<void>;

/** 写通 coalescer 实例（三态语义见模块注释）。 */
export interface RunStateWritethrough {
  /** 全量快照暂存 + 节流调度（大载荷自动升到慢档）。 */
  append(state: SessionRunState): void;
  /** 立即写（同步发起；无待写数据 no-op；dispose 后 no-op）。 */
  flush(): void;
  /** 丢弃未写数据并停用（此后一切方法 no-op）。 */
  dispose(): void;
  /** 是否已停用（诊断/测试用）。 */
  isDisposed(): boolean;
  /** 是否有待写数据（诊断/测试用）。 */
  hasPending(): boolean;
}

/** 估算单次载荷大小（字符数）：partial 两段 + pending 链接 JSON。 */
function estimatePayloadChars(state: SessionRunState): number {
  return (
    (state.partialText?.length ?? 0) +
    (state.partialThinking?.length ?? 0) +
    (state.pendingChildrenJson?.length ?? 0)
  );
}

export function createRunStateWritethrough(
  write: RunStateWritethroughWriteFn,
  options?: {
    /** 正常档间隔（测试可覆盖）。 */
    readonly intervalMs?: number;
    /** 慢档间隔（测试可覆盖）。 */
    readonly slowIntervalMs?: number;
    /** 大载荷阈值字符数（测试可覆盖）。 */
    readonly largePayloadChars?: number;
  },
): RunStateWritethrough {
  const intervalMs =
    options?.intervalMs ?? RUN_STATE_WRITETHROUGH_INTERVAL_MS;
  const slowIntervalMs =
    options?.slowIntervalMs ?? RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS;
  const largePayloadChars =
    options?.largePayloadChars ??
    RUN_STATE_WRITETHROUGH_LARGE_PAYLOAD_CHARS;

  let pending: SessionRunState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 当前定时器的档位（毫秒）：仅当新载荷要求更慢的档时才重排。 */
  let scheduledMs = 0;
  let disposed = false;

  const clearTimer = (): void => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    scheduledMs = 0;
  };

  /** 定时到期/flush 的共同落点：取走 pending 并同步发起写（吞错留日志）。 */
  const writeNow = (): void => {
    timer = null;
    scheduledMs = 0;
    if (pending == null) {
      return;
    }
    const state = pending;
    pending = null;
    write(state).catch(err => {
      console.error(
        '[novel-master/run-state-writethrough] write failed',
        err,
      );
    });
  };

  return {
    append(state: SessionRunState): void {
      if (disposed) {
        return;
      }
      pending = state;
      const wantMs =
        estimatePayloadChars(state) > largePayloadChars
          ? slowIntervalMs
          : intervalMs;
      if (timer == null) {
        timer = setTimeout(writeNow, wantMs);
        scheduledMs = wantMs;
      } else if (wantMs > scheduledMs) {
        // 载荷变大 → 升到慢档重排（推迟写，防写放大）；变小则等本轮到期
        // 后自然恢复快档，不做提前重排。
        clearTimer();
        timer = setTimeout(writeNow, wantMs);
        scheduledMs = wantMs;
      }
    },

    flush(): void {
      if (disposed) {
        return;
      }
      clearTimer();
      writeNow();
    },

    dispose(): void {
      clearTimer();
      pending = null;
      disposed = true;
    },

    isDisposed(): boolean {
      return disposed;
    },

    hasPending(): boolean {
      return pending != null;
    },
  };
}
