/**
 * T-R0 mobile 半（rollback-large-jank Step 1）：[nm-rollback] 打点轴的
 * __DEV__ 门控与窗口语义断言。
 *
 * - __DEV__ 下 resetRollbackTiming 定 t0，其后 rollbackTimingLog 输出
 *   `[nm-rollback] label +Nms` 形态（真机 logcat 过滤口径）。
 * - 未 reset（回滚窗口外）时 no-op——共享代码路径（快照构建等）埋点
 *   不产生日志。
 * - B-01：窗口上限 10s 自动失效——t0 只开不关若无上限，首次回滚后
 *   日常滚动会永久往同一条 t0 打点；超窗后首个站点自愈关窗。
 * - __DEV__=false（生产 bundle）时全 no-op。
 */
import {beforeEach, afterEach, describe, expect, it, jest} from '@jest/globals';

const {
  resetRollbackTiming,
  rollbackTimingLog,
} = require('../src/debug/run-timing');

describe('rollback timing 轴（T-R0）', () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    // 恢复 __DEV__（RN jest preset 默认 true），避免污染其它用例。
    Object.defineProperty(global, '__DEV__', {
      configurable: true,
      value: true,
    });
  });

  it('T-R0: __DEV__ 下回滚链打点可被探针捕获（[nm-rollback] 前缀 + 相对耗时）', () => {
    resetRollbackTiming();
    rollbackTimingLog('core rollback done');

    const lines = logSpy.mock.calls.map(call => String(call[0]));
    expect(lines.some(l => l.startsWith('[nm-rollback] t0 rollback'))).toBe(
      true,
    );
    expect(
      lines.some(l =>
        /^\[nm-rollback\] core rollback done \+\d+ms$/.test(l),
      ),
    ).toBe(true);
  });

  it('未 reset（回滚窗口外）rollbackTimingLog no-op——共享路径埋点零输出', () => {
    // 直接 require 新模块实例模拟「本轮回滚尚未开始」的窗口外状态：
    // 模块级 rollbackT0 初始为 0。
    jest.resetModules();
    const fresh = require('../src/debug/run-timing');
    fresh.rollbackTimingLog('snapshot all chunks done');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('__DEV__=false（生产）时 reset 与打点全 no-op', () => {
    Object.defineProperty(global, '__DEV__', {
      configurable: true,
      value: false,
    });
    resetRollbackTiming();
    rollbackTimingLog('core rollback done');
    expect(logSpy).not.toHaveBeenCalled();
  });
});

// B-01：窗口上限（ROLLBACK_TIMING_WINDOW_MS = 10s）自动失效。
// 用 Date mock 钉住时钟，不依赖真实墙钟。
describe('rollback timing 窗口上限（B-01）', () => {
  const WINDOW_MS = 10000;
  const T0 = 1_700_000_000_000;
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let dateSpy: jest.SpiedFunction<typeof Date.now>;
  let now: number;

  beforeEach(() => {
    now = T0;
    dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    // 每个用例都从「干净窗口」起步：重置模块拿到 rollbackT0=0 的新实例。
    jest.resetModules();
  });

  afterEach(() => {
    logSpy.mockRestore();
    dateSpy.mockRestore();
  });

  it('窗口内（<10s）正常打点——elapsed 相对 t0 可读', () => {
    const fresh = require('../src/debug/run-timing');
    fresh.resetRollbackTiming();
    logSpy.mockClear();

    now = T0 + WINDOW_MS - 1;
    fresh.rollbackTimingLog('core rollback done');

    const lines = logSpy.mock.calls.map(call => String(call[0]));
    expect(lines).toEqual([
      `[nm-rollback] core rollback done +${WINDOW_MS - 1}ms`,
    ]);
  });

  it('窗口超时（>10s）自动失效——首个超窗站点把 t0 复位为 0 且零输出', () => {
    const fresh = require('../src/debug/run-timing');
    fresh.resetRollbackTiming();
    logSpy.mockClear();

    now = T0 + WINDOW_MS + 1;
    fresh.rollbackTimingLog('core rollback done');
    expect(logSpy).not.toHaveBeenCalled();

    // 关窗是自愈的：后续站点继续 no-op（t0 已被复位为 0）。
    now = T0 + WINDOW_MS + 5000;
    fresh.rollbackTimingLog('tail reload done');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('恰好 10s 边界仍打点（判定为 > 而非 >=，窗口内含端点）', () => {
    const fresh = require('../src/debug/run-timing');
    fresh.resetRollbackTiming();
    logSpy.mockClear();

    now = T0 + WINDOW_MS;
    fresh.rollbackTimingLog('boundary station');

    const lines = logSpy.mock.calls.map(call => String(call[0]));
    expect(lines).toEqual([`[nm-rollback] boundary station +${WINDOW_MS}ms`]);
  });
});
