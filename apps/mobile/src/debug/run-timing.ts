/**
 * 生成链路首帧延迟打点（__DEV__ 门控的临时诊断工具）。
 *
 * 用法：executeRun 入口 resetRunTiming() 定 t0，链路各站 timingLog('站名')，
 * logcat 过滤 `[nm-timing]` 即得「点发送 → 状态条渲染」全链路相对时间轴。
 * 生产/测试环境所有函数为 no-op。
 *
 * @module debug/run-timing
 */

let t0 = 0;

/** 重置计时起点（每轮发送入口调用一次）。 */
export function resetRunTiming(): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    t0 = Date.now();
    console.log('[nm-timing] t0 send');
  }
}

/** 打一站相对 t0 的耗时；未 reset 时 no-op。 */
export function timingLog(label: string): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  if (t0 === 0) {
    return;
  }
  console.log(`[nm-timing] ${label} +${Date.now() - t0}ms`);
}
// refresh-trigger 1789305097
// refresh-trigger-2 1789305385
