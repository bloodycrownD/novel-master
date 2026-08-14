/**
 * useSubagentRunProbe / useSubagentRunPolling 测试：T-G2-mobile。
 *
 * 模拟 RUN_FINISHED 事件丢失（不调 onRunEnded），mock isRunRegistered 返回 false，
 * 兜底应触发 onRunEnded。分别覆盖：
 * - AppState → active 触发（useSubagentRunProbe）
 * - 轮询触发（useSubagentRunPolling，uiRunning=true 时启动）
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {AppState} from 'react-native';
import {
  useSubagentRunProbe,
  useSubagentRunPolling,
  SUBAGENT_RUN_PROBE_RECONFIRM_DELAY_MS,
} from '../src/screens/stack/useSubagentRunProbe';

/** AppState mock：取棕 listener 供测试主动触发。 */
let appStateListener: (state: string) => void = () => undefined;

function flushTimers(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
    jest.advanceTimersByTime(ms);
  });
}

describe('useSubagentRunProbe — T-G2-mobile', () => {
  let spy: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    jest.useFakeTimers();
    appStateListener = () => undefined;
    spy = jest.spyOn(AppState, 'addEventListener');
    spy.mockImplementation(
      (_event: unknown, cb: (state: string) => void) => {
        appStateListener = cb;
        return {remove: () => undefined} as unknown as {remove: () => void};
      },
    );
  });
  afterEach(() => {
    jest.useRealTimers();
    spy.mockRestore();
  });

  it('isRunActive=true 且 isRunRegistered=false 时，AppState→active 触发收尾', async () => {
    const onRunEnded = jest.fn();
    const isRunActive = jest.fn(() => true);
    const isRunRegistered = jest.fn(() => false);

    function Harness() {
      useSubagentRunProbe({isRunActive, isRunRegistered, onRunEnded});
      return null;
    }
    let r: any;
    act(() => {
      r = TestRenderer.create(React.createElement(Harness));
    });

    // 模拟 RUN_FINISHED 丢失：只触发 AppState active，不派发任何事件。
    act(() => {
      appStateListener('active');
    });

    // 复询防抖延迟前不触发
    expect(onRunEnded).not.toHaveBeenCalled();

    await act(async () => {
      await flushTimers(SUBAGENT_RUN_PROBE_RECONFIRM_DELAY_MS + 50);
    });

    expect(isRunRegistered).toHaveBeenCalled();
    expect(onRunEnded).toHaveBeenCalledTimes(1);
    act(() => { r.unmount(); });
  });

  it('isRunActive=false 时 AppState→active 不触发收尾（主路径已处理）', async () => {
    const onRunEnded = jest.fn();
    const isRunActive = jest.fn(() => false);
    const isRunRegistered = jest.fn(() => false);

    function Harness() {
      useSubagentRunProbe({isRunActive, isRunRegistered, onRunEnded});
      return null;
    }
    let r: any;
    act(() => {
      r = TestRenderer.create(React.createElement(Harness));
    });
    act(() => {
      appStateListener('active');
    });
    await act(async () => {
      await flushTimers(SUBAGENT_RUN_PROBE_RECONFIRM_DELAY_MS + 50);
    });
    expect(onRunEnded).not.toHaveBeenCalled();
    act(() => { r.unmount(); });
  });

  it('第一次 false、复询时变 true 则不收尾（防抖避免误判）', async () => {
    const onRunEnded = jest.fn();
    const isRunActive = jest.fn(() => true);
    // 第一次查询 false，复询时 true（registry 暂态）
    let registered = false;
    const isRunRegistered = jest.fn(() => {
      const v = registered;
      registered = true;
      return v;
    });

    function Harness() {
      useSubagentRunProbe({isRunActive, isRunRegistered, onRunEnded});
      return null;
    }
    let r: any;
    act(() => {
      r = TestRenderer.create(React.createElement(Harness));
    });
    act(() => {
      appStateListener('active');
    });
    await act(async () => {
      await flushTimers(SUBAGENT_RUN_PROBE_RECONFIRM_DELAY_MS + 50);
    });
    expect(onRunEnded).not.toHaveBeenCalled();
    act(() => { r.unmount(); });
  });
});

describe('useSubagentRunPolling — T-G2-mobile 轮询路径', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('uiRunning=true 且 isRunRegistered=false 时，轮询周期后触发收尾', async () => {
    const onRunEnded = jest.fn();
    const isRunActive = jest.fn(() => true);
    const isRunRegistered = jest.fn(() => false);

    function Harness() {
      useSubagentRunPolling(true, isRunActive, isRunRegistered, onRunEnded);
      return null;
    }
    let r: any;
    act(() => {
      r = TestRenderer.create(React.createElement(Harness));
    });

    // 轮询周期触发 probe，再过复询延迟后收尾
    await act(async () => {
      await flushTimers(30_000);
    });
    await act(async () => {
      await flushTimers(SUBAGENT_RUN_PROBE_RECONFIRM_DELAY_MS + 50);
    });

    expect(onRunEnded).toHaveBeenCalledTimes(1);
    act(() => { r.unmount(); });
  });

  it('uiRunning=false 时不启动轮询', async () => {
    const onRunEnded = jest.fn();
    function Harness() {
      useSubagentRunPolling(false, () => true, () => false, onRunEnded);
      return null;
    }
    let r: any;
    act(() => {
      r = TestRenderer.create(React.createElement(Harness));
    });
    await act(async () => {
      await flushTimers(60_000);
    });
    expect(onRunEnded).not.toHaveBeenCalled();
    act(() => { r.unmount(); });
  });
});
