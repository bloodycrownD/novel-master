/**
 * 生成链路首帧延迟打点（__DEV__ 门控的临时诊断工具）。
 *
 * 用法：executeRun 入口 resetRunTiming() 定 t0，链路各站 timingLog('站名')，
 * logcat 过滤 `[nm-timing]` 即得「点发送 → 状态条渲染」全链路相对时间轴。
 * 生产/测试环境所有函数为 no-op。
 *
 * 三条轴（发送 / 回滚 / 冷启动）共用一份 {@link createTimingAxis} 实现，差异
 * 只在标签、reset 文案、窗口上限与 t0 起点：回滚轴带窗口自愈，冷启动轴的
 * t0 固定在模块求值时刻，发送轴两者都不要。
 *
 * @module debug/run-timing
 */

/** 一条打点轴：`reset()` 定 t0，`log(label)` 打相对 t0 的耗时。 */
type TimingAxis = {
    readonly reset: () => void;
    readonly log: (message: string) => void;
};

type TimingAxisOptions = {
    /** reset 时输出 `[<label>] t0 <resetMessage>`。 */
    readonly resetMessage?: string;
    /**
   * 窗口上限（毫秒）：超窗后首个站点把 t0 复位为 0（自愈关窗），后续站点
   * 保持 no-op。不设上限时 reset 后窗口永久打开。
   */
    readonly windowMs?: number;
    /** t0 取模块求值时刻（冷启动轴），不等待 reset。 */
    readonly startAtModuleEval?: boolean;
};

/** dev 环境判定：__DEV__ 未定义（生产/测试）时恒 false。 */
function isDevEnabled(): boolean {
    return typeof __DEV__ !== 'undefined' && __DEV__;
}

/** 造一条打点轴；t0 与窗口状态收在闭包里，不散成模块级 let。 */
function createTimingAxis(label: string, options: TimingAxisOptions = {}): TimingAxis {
    let t0 = options.startAtModuleEval === true ? Date.now() : 0;
    // nm-style: keep-closure — t0 是可重绑时间游标且三条轴多实例各自持游标，槽化产出与现有 TimingAxis 同构、无复用收益
    const reset = (): void => {
        if (!isDevEnabled()) {
            return;
        }
        t0 = Date.now();
        console.log(`[${label}] t0 ${options.resetMessage ?? ''}`);
    };
    // nm-style: keep-closure — t0 重绑 + 超窗自愈（置 0 后续 no-op）是三实例各自的状态机，闭包是既定设计
    const log = (message: string): void => {
        if (!isDevEnabled() || t0 === 0) {
            return;
        }
        if (options.windowMs != null && Date.now() - t0 > options.windowMs) {
            t0 = 0;
            return;
        }
        console.log(`[${label}] ${message} +${Date.now() - t0}ms`);
    };
    return {reset, log};
}

/**
 * 回滚计时窗口上限（毫秒）：回滚轴 t0 只在回滚入口赋值、全仓无显式关闭点，
 * 若不设上限则首次回滚后窗口永久打开，日常滚动与快照分片会持续往同一条
 * t0 上打点，logcat 被淹没、回滚轴失去可判读性。取值依据：回滚链 AC-1
 * 目标为秒级（toast → 界面刷新 <1s），10s 为充裕余量；超时后首个站点即
 * 自动把 t0 复位为 0，窗口自愈。
 */
const ROLLBACK_TIMING_WINDOW_MS = 10000;

const runAxis = createTimingAxis('nm-timing', {resetMessage: 'send'});
const rollbackAxis = createTimingAxis('nm-rollback', {resetMessage: 'rollback', windowMs: ROLLBACK_TIMING_WINDOW_MS});
/** 启动基准：t0 是模块求值时刻（dev bundle 加载即计时）。冷启动初始化链
 * （水合/快照分片/webview ready）没有发送 t0，统一挂这条轴，logcat 过滤
 * `[nm-boot]` 即得冷启动全链时间轴。 */
const bootAxis = createTimingAxis('nm-boot', {startAtModuleEval: true});

/** 重置计时起点（每轮发送入口调用一次）。 */
export const resetRunTiming = runAxis.reset;

/** 打一站相对 t0 的耗时；未 reset 时 no-op。 */
export const timingLog = runAxis.log;

/** 重置回滚链计时起点（每轮回滚入口调用一次）。 */
export const resetRollbackTiming = rollbackAxis.reset;

/** 打一回滚链站点相对 t0 的耗时；不在回滚窗口时 no-op。 */
export const rollbackTimingLog = rollbackAxis.log;

/** 打一站相对 JS bundle 求值时刻的耗时（冷启动链专用）。 */
export const bootTimingLog = bootAxis.log;
