/**
 * 收尾校准探针测试（Step 7 自 subagent-run-probe.test 改写，T-G2 等价）。
 *
 * 旧探针（use-run-resume-probe/useSubagentRunProbe）的「恢复方向」随单元
 * 水合退役；这里只保留「收尾方向」——模拟 RUN_FINISHED/RUN_FAILED 事件
 * 丢失（registry 已无注册），校准兜底应触发 onRunLost。分别覆盖：
 * - 纯逻辑：手动 calibrate / 轮询触发 / 复询防抖 / dispose 清理
 * - manager 级集成：事件丢失 → settle('failed') + refcount 归零；
 *   starting（受理空窗）不参与校准防误杀。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import {AppState} from 'react-native';
import {EVENT_AGENT_RUN_STARTED, SimpleEventBus} from '@novel-master/core/events';
import {
  createRunFinishCalibrationProbe,
  RUN_FINISH_CALIBRATION_INTERVAL_MS,
  RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS,
} from '@/services/run-finish-calibration-probe';
import {
  SessionStreamUnitManager,
} from '@/services/session-stream-unit-manager.service';
import {
  isMobileAgentActive,
  setMobileAgentActive,
} from '@/runtime/agent-activity';

function flushTimers(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
    jest.advanceTimersByTime(ms);
  });
}

describe('run-finish-calibration-probe — 纯逻辑', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('calibrate：活跃会话未注册 → 复询后仍 false 触发 onRunLost', async () => {
    const onRunLost = jest.fn();
    const probe = createRunFinishCalibrationProbe({
      activeSessionIds: () => ['s1'],
      isRunRegistered: () => false,
      onRunLost,
    });
    probe.calibrate();
    // 复询防抖延迟前不触发
    expect(onRunLost).not.toHaveBeenCalled();
    await flushTimers(RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS + 50);
    expect(onRunLost).toHaveBeenCalledTimes(1);
    expect(onRunLost).toHaveBeenCalledWith('s1');
    probe.dispose();
  });

  it('第一次 false、复询时变 true 则不收尾（防抖避免误判）', async () => {
    const onRunLost = jest.fn();
    let registered = false;
    const probe = createRunFinishCalibrationProbe({
      activeSessionIds: () => ['s1'],
      isRunRegistered: () => {
        const v = registered;
        registered = true;
        return v;
      },
      onRunLost,
    });
    probe.calibrate();
    await flushTimers(RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS + 50);
    expect(onRunLost).not.toHaveBeenCalled();
    probe.dispose();
  });

  it('已注册的会话不排复询（主路径健康时校准零动作）', async () => {
    const onRunLost = jest.fn();
    const isRunRegistered = jest.fn(() => true);
    const probe = createRunFinishCalibrationProbe({
      activeSessionIds: () => ['s1'],
      isRunRegistered,
      onRunLost,
    });
    probe.calibrate();
    await flushTimers(RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS + 50);
    expect(onRunLost).not.toHaveBeenCalled();
    probe.dispose();
  });

  it('复询前会话已正常收尾（activeSessionIds 不再包含）则不触发', async () => {
    const onRunLost = jest.fn();
    let active = true;
    const probe = createRunFinishCalibrationProbe({
      activeSessionIds: () => (active ? ['s1'] : []),
      isRunRegistered: () => false,
      onRunLost,
    });
    probe.calibrate();
    active = false; // 复询前事件路径已收尾
    await flushTimers(RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS + 50);
    expect(onRunLost).not.toHaveBeenCalled();
    probe.dispose();
  });

  it('轮询路径：setPollingEnabled(true) 后按周期触发校准', async () => {
    const onRunLost = jest.fn();
    const probe = createRunFinishCalibrationProbe({
      activeSessionIds: () => ['s1'],
      isRunRegistered: () => false,
      onRunLost,
    });
    probe.setPollingEnabled(true);
    // 轮询周期刻度：interval 触发校准、排入复询，但复询未到不收尾
    jest.advanceTimersByTime(RUN_FINISH_CALIBRATION_INTERVAL_MS);
    expect(onRunLost).not.toHaveBeenCalled();
    jest.advanceTimersByTime(RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS + 50);
    expect(onRunLost).toHaveBeenCalledTimes(1);
    probe.dispose();
  });

  it('dispose 后复询不再触发 onRunLost（定时器随 dispose 清理）', async () => {
    const onRunLost = jest.fn();
    const probe = createRunFinishCalibrationProbe({
      activeSessionIds: () => ['s1'],
      isRunRegistered: () => false,
      onRunLost,
    });
    probe.calibrate();
    // 排入 800ms 复询后、到期前销毁
    probe.dispose();
    await flushTimers(RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS + 50);
    expect(onRunLost).not.toHaveBeenCalled();
  });

  it('轮询关闭（默认/setPollingEnabled(false)）时不触发周期校准', async () => {
    const onRunLost = jest.fn();
    const probe = createRunFinishCalibrationProbe({
      activeSessionIds: () => ['s1'],
      isRunRegistered: () => false,
      onRunLost,
    });
    await flushTimers(RUN_FINISH_CALIBRATION_INTERVAL_MS * 3);
    expect(onRunLost).not.toHaveBeenCalled();
    probe.dispose();
  });
});

describe('run-finish-calibration-probe — manager 级集成', () => {
  /** AppState mock：取走 listener 供测试主动触发前台回焦。 */
  let appStateListener: (state: string) => void = () => undefined;
  let appStateSpy: ReturnType<typeof jest.spyOn>;
  const liveManagers: SessionStreamUnitManager[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
    setMobileAgentActive(false);
    appStateListener = () => undefined;
    appStateSpy = jest.spyOn(AppState, 'addEventListener');
    appStateSpy.mockImplementation(
      (_event: unknown, cb: (state: string) => void) => {
        appStateListener = cb;
        return {remove: () => undefined} as unknown as {remove: () => void};
      },
    );
  });
  afterEach(() => {
    for (const manager of liveManagers.splice(0)) {
      manager.dispose();
    }
    setMobileAgentActive(false);
    appStateSpy.mockRestore();
    jest.useRealTimers();
  });

  function createManagerHarness(abortHas: (sessionId: string) => boolean) {
    const eventBus = new SimpleEventBus();
    const abortRegistry = {
      has: jest.fn((sessionId: string) => abortHas(sessionId)),
      abort: jest.fn(),
      register: jest.fn(),
      unregister: jest.fn(),
    };
    const sessions = {
      get: jest.fn(async (sessionId: string) => ({
        id: sessionId,
        title: `会话-${sessionId}`,
      })),
    };
    const projects = {
      get: jest.fn(async (projectId: string) => ({
        id: projectId,
        name: `项目-${projectId}`,
      })),
    };
    const runAgentTurn = jest.fn(
      () => new Promise<void>(() => undefined), // 挂起：终态只由校准兜底驱动
    );
    const manager = new SessionStreamUnitManager({
      runtime: {eventBus, abortRegistry, sessions, projects} as never,
      runAgentTurn: runAgentTurn as never,
    });
    manager.markHydrated();
    liveManagers.push(manager);
    return {eventBus, manager};
  }

  it('事件丢失（registry 已无注册）→ 轮询校准 settle(failed) 且 refcount 归零', async () => {
    // runAgentTurn 挂起 + FINISHED 永不到达 = 终态事件丢失现场。
    const h = createManagerHarness(() => false);
    h.manager.startRun('a', 'p', 'hi');
    h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 'a',
      projectId: 'p',
      runId: 'r1',
    });
    expect(h.manager.snapshot('a')?.status).toBe('running');
    expect(isMobileAgentActive()).toBe(true);

    // 推进轮询周期 + 复询防抖：校准收尾生效
    await flushTimers(RUN_FINISH_CALIBRATION_INTERVAL_MS + 1);
    await flushTimers(RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS + 50);

    expect(h.manager.snapshot('a')?.status).toBe('failed');
    expect(isMobileAgentActive()).toBe(false);
  });

  it('前台回焦触发校准（AppState → active 走 calibrate 路径）', async () => {
    const h = createManagerHarness(() => false);
    h.manager.startRun('a', 'p', 'hi');
    h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 'a',
      projectId: 'p',
      runId: 'r1',
    });

    // 不推进轮询周期，仅模拟回前台
    appStateListener('active');
    await flushTimers(RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS + 50);
    expect(h.manager.snapshot('a')?.status).toBe('failed');
    expect(isMobileAgentActive()).toBe(false);
  });

  it('starting 单元（RUN_STARTED 未达、runId 未回填）不参与校准——受理空窗防误杀', async () => {
    const h = createManagerHarness(() => false);
    h.manager.startRun('a', 'p', 'hi');
    expect(h.manager.snapshot('a')?.status).toBe('starting');

    appStateListener('active');
    await flushTimers(RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS + 50);
    // starting 不被校准收尾（死 starting 由 startRun 的 finally 兜底）
    expect(h.manager.snapshot('a')?.status).toBe('starting');
  });
});
