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

// 回滚轴（rollback-large-jank Step 1）：用户确认回滚时 resetRollbackTiming()
// 定 t0，回滚链各段（core 事务子步 / tail reload / 快照分片 / web 渲染回执 /
// token 刷新）rollbackTimingLog('站名')，logcat 过滤 `[nm-rollback]` 即得
// 「点回滚 → 界面刷新完成」全链时间轴。窗口外（t0=0 或距 t0 超过
// ROLLBACK_TIMING_WINDOW_MS）所有站 no-op，因此快照构建等共享代码路径
// 可直接埋点、不影响非回滚场景。真机基线采集与修复前后对比共用这条轴。

/**
 * 回滚计时窗口上限（毫秒）：rollbackT0 只在回滚入口赋值、全仓无显式关闭
 * 点，若不设上限则首次回滚后窗口永久打开，日常滚动与快照分片会持续往同
 * 一条 t0 上打点，logcat 被淹没、回滚轴失去可判读性。取值依据：回滚链
 * AC-1 目标为秒级（toast → 界面刷新 <1s），10s 为充裕余量；超时后首个站点
 * 即自动把 rollbackT0 复位为 0，窗口自愈。
 */
const ROLLBACK_TIMING_WINDOW_MS = 10000;

let rollbackT0 = 0;

/** 重置回滚链计时起点（每轮回滚入口调用一次）。 */
export function resetRollbackTiming(): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    rollbackT0 = Date.now();
    console.log('[nm-rollback] t0 rollback');
  }
}

/** 打一回滚链站点相对 t0 的耗时；不在回滚窗口时 no-op。 */
export function rollbackTimingLog(label: string): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  if (rollbackT0 === 0) {
    return;
  }
  // 窗口上限自动失效：距 t0 超过 ROLLBACK_TIMING_WINDOW_MS 即自愈关窗
  // （顺带覆盖 t0=0 的入口守卫——Date.now() 是 epoch 量级，必然远超窗口）。
  if (Date.now() - rollbackT0 > ROLLBACK_TIMING_WINDOW_MS) {
    rollbackT0 = 0;
    return;
  }
  console.log(`[nm-rollback] ${label} +${Date.now() - rollbackT0}ms`);
}

// 启动基准：模块求值时刻（dev bundle 加载即计时）。冷启动初始化链
// （水合/快照分片/webview ready）没有发送 t0，统一挂这条轴，logcat 过滤
// `[nm-boot]` 即得冷启动全链时间轴。
const bootT0 = Date.now();

/** 打一站相对 JS bundle 求值时刻的耗时（冷启动链专用）。 */
export function bootTimingLog(label: string): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  console.log(`[nm-boot] ${label} +${Date.now() - bootT0}ms`);
}
