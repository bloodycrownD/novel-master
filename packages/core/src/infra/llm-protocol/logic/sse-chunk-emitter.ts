/**
 * React Native XHR 传输用的 SSE chunk 整流 emitter（RN 后台连续执行改造）。
 *
 * XHR `onprogress` 可以在单个回调里投递大段 `responseText` 切片，每次切片
 * 都同步走 `onChunk` 会让 RN JS 事件循环饿死。本模块缓冲到达的文本，以
 * tickMs（默认 32ms）为窗口整流投递：平滑突发但不限吞吐。
 *
 * 投递有两条通道、共用同一个时间闸门：
 * - 数据到达驱动：`append()` 时距上次 flush 已过 tickMs 即立即同步 flush
 *   ——onprogress 由原生网络事件（didReceiveNetworkData）触发、不经
 *   Choreographer，app 后台 interval 停摆时数据到达仍能持续推进 run；
 * - interval tick 兜底：前台主路径，到点 flush，节奏与纯 interval 方案
 *   完全一致。
 *
 * 闸门约束的实际语义：窗口内多次 append 至多触发一次同步 flush；interval
 * 兜底通道不受闸门约束，因此 append 投递与紧随其后的 tick 投递之间的间隔
 * 可以小于 tickMs（最坏 0ms）。整流上限是每 tickMs（默认 32ms）一次
 * append 触发的同步 flush + 一次 tick 兜底 flush。
 *
 * Invariants:
 * - `append()` 只在距上次 flush 已过 tickMs 闸门时才同步调用 `onChunk`
 *   （窗口内的 append 只进缓冲、零投递）
 * - 每次 flush 把整个缓冲作为单个 chunk 投递并清空缓冲
 * - `flush()` 停掉 interval、返回剩余缓冲并清零（调用方可以自行 onChunk）
 * - `dispose()` 停掉 interval 并丢弃未投递的缓冲
 * - `flush()` / `dispose()` 之后 emitter 进入终态，后续 `append()` 为 no-op
 *   （既不进缓冲，也不投递）
 *
 * @module infra/llm-protocol/logic/sse-chunk-emitter
 */

export const DEFAULT_TICK_MS = 32;

export interface SseChunkEmitter {
  /**
   * 追加 XHR 切片。距上次 flush 已过 tickMs 闸门时立即同步 flush（会调用
   * onChunk）；窗口内的 append 只进缓冲、不投递。`flush()` / `dispose()`
   * 之后本方法为 no-op。
   */
  append(text: string): void;
  /** 停掉 tick；返回并清空缓冲（调用方可同步 onChunk）。调用后进入终态。 */
  flush(): string;
  /** 停掉 tick 并丢弃未投递的缓冲（error/abort 路径）。调用后进入终态。 */
  dispose(): void;
  /** 当前待发缓冲长度（流超时观测打点用，只读，不改缓冲行为）。 */
  bufferedLength(): number;
}

export function createSseChunkEmitter(
  onChunk: (chunk: string) => void,
  options?: { tickMs?: number }
): SseChunkEmitter {
  const tickMs = options?.tickMs ?? DEFAULT_TICK_MS;
  let buffer = "";
  // 初始化为创建时刻（不能是 0）：若初始化为 0，首个 append 距「上次
  // flush」必然已过 tickMs、立即开闸同步 flush，「append 后不 tick 则
  // 零投递」的既有语义（U-01）即碎。初始化为创建时刻，测试里紧跟创建
  // 的首个 append 会落在开闸窗口内、进缓冲等 tick。
  // 注意：这只在「创建到首个 append < tickMs」时成立，生产环境不成立——
  // 建连 + TTFT 通常远超 32ms，首个 chunk 走「过闸直投」属预期行为，
  // 也正是后台连续性依赖的路径（interval 停摆时靠数据到达推进）。
  let lastFlushAt = Date.now();
  // 终态标志：`flush()` / `dispose()` 之后置位，`append()` 不再有任何效果。
  let stopped = false;

  const emitBuffer = (): void => {
    if (buffer.length === 0) {
      return;
    }
    const chunk = buffer;
    buffer = "";
    lastFlushAt = Date.now();
    onChunk(chunk);
  };

  let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    emitBuffer();
  }, tickMs);

  const stopTimer = (): void => {
    // 停表的同时进入终态：`flush()` / `dispose()` 是两条终态路径，
    // 走完之后 `append()` 一律 no-op。
    stopped = true;
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    append(text: string): void {
      // 终态守卫：flush / dispose 之后不再缓冲、也不再投递。
      if (stopped) {
        return;
      }
      buffer += text;
      // 数据到达驱动 + 时间闸门：过闸的 append 立即同步 flush（后台
      // interval 停摆时投递仍由数据到达推进）；未过闸的 append 留缓冲，
      // interval tick 照旧兜底 flush。闸门保证窗口内至多一次同步 flush；
      // tick 通道本身不过闸，故 append 投递与紧随 tick 的投递可相隔
      // 0ms，整流上限为每 tickMs 一次 append 触发 + 一次 tick。
      if (Date.now() - lastFlushAt >= tickMs) {
        emitBuffer();
      }
    },

    flush(): string {
      stopTimer();
      const tail = buffer;
      buffer = "";
      return tail;
    },

    dispose(): void {
      stopTimer();
      buffer = "";
    },

    bufferedLength(): number {
      return buffer.length;
    },
  };
}
