import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useSessionAbort} from '@/screens/tabs/chat-tab/useSessionAbort';
import type {UseSessionAbortResult} from '@/screens/tabs/chat-tab/useSessionAbort';

/**
 * abort 单元测试：uiRunning / freezeCount / abortRetainPending 状态机 +
 * abortRegistry.abort 调用 + onStreamResetRef 解耦。
 */
describe('useSessionAbort', () => {
  function mountAbort(options?: {
    sessionId?: string;
    abortRegistry?: {
      register?: jest.Mock;
      abort?: jest.Mock;
      unregister?: jest.Mock;
      has?: jest.Mock;
    };
    onStreamResetRef?: React.MutableRefObject<() => void>;
  }): UseSessionAbortResult {
    const api: {current?: UseSessionAbortResult} = {};
    const onStreamResetRef =
      options?.onStreamResetRef ??
      ({current: jest.fn()} as unknown as React.MutableRefObject<() => void>);
    const abortRegistry = options?.abortRegistry ?? {
      register: jest.fn(),
      abort: jest.fn(),
      unregister: jest.fn(),
      has: jest.fn(() => false),
    };

    function Harness() {
      api.current = useSessionAbort({
        sessionId: options?.sessionId ?? 's1',
        abortRegistry: abortRegistry as never,
        onStreamResetRef,
      });
      return null;
    }

    act(() => {
      TestRenderer.create(React.createElement(Harness));
    });
    expect(api.current).toBeDefined();
    return api.current!;
  }

  it('T-ARP-L1: abortUiRun 设 abortRetainPending 且不调 onStreamReset', () => {
    const onStreamReset = jest.fn();
    const onStreamResetRef = {current: onStreamReset} as never;
    const abort = mountAbort({onStreamResetRef});
    abort.markRunStarted();
    abort.abortUiRun(5);
    expect(abort.getUiRunning()).toBe(false);
    expect(abort.getAbortRetainPending()).toBe(true);
    expect(onStreamReset).not.toHaveBeenCalled();
  });

  it('T-AC2-10：abortUiRun(freezeAt) 设 freezeCount 且 getUiRunning 同步 false', () => {
    const abortRegistry = {abort: jest.fn(), has: jest.fn(() => false)};
    const abort = mountAbort({sessionId: 's1', abortRegistry});
    abort.markRunStarted();
    expect(abort.getUiRunning()).toBe(true);

    abort.abortUiRun(5);

    expect(abort.getUiRunning()).toBe(false);
    expect(abort.getTranscriptFreezeCount()).toBe(5);
    expect(abortRegistry.abort).toHaveBeenCalledWith('s1');
  });

  it('getAbortRetainPending / clearAbortRetainPending', () => {
    const abort = mountAbort();
    abort.markRunStarted();
    abort.abortUiRun(4);
    expect(abort.getAbortRetainPending()).toBe(true);

    abort.clearAbortRetainPending();
    expect(abort.getAbortRetainPending()).toBe(false);

    abort.abortUiRun(3);
    expect(abort.getAbortRetainPending()).toBe(true);
    expect(abort.getTranscriptFreezeCount()).toBe(3);
  });

  it('markRunStarted 清 freeze/retain', () => {
    const abort = mountAbort();
    abort.markRunStarted();
    abort.abortUiRun(6);
    expect(abort.getAbortRetainPending()).toBe(true);
    expect(abort.getTranscriptFreezeCount()).toBe(6);

    abort.markRunStarted();
    expect(abort.getAbortRetainPending()).toBe(false);
    expect(abort.getTranscriptFreezeCount()).toBe(null);
    expect(abort.getUiRunning()).toBe(true);
  });

  it('markRunEnded 清 freezeCount 但不动 retain', () => {
    const abort = mountAbort();
    abort.markRunStarted();
    abort.abortUiRun(4);
    expect(abort.getTranscriptFreezeCount()).toBe(4);

    abort.markRunEnded();
    expect(abort.getTranscriptFreezeCount()).toBe(null);
    expect(abort.getUiRunning()).toBe(false);
    // retain 由 stream 单元的 FINISHED fallback 路径 clearAbortRetainPending 清，
    // markRunEnded 不主动清——保持单一职责。
    expect(abort.getAbortRetainPending()).toBe(true);
  });

  it('resetForSessionChange 清 freeze/retain/uiRunning 并触发 onStreamReset', () => {
    const onStreamReset = jest.fn();
    const onStreamResetRef = {current: onStreamReset} as never;
    const abort = mountAbort({onStreamResetRef});
    abort.markRunStarted();
    abort.abortUiRun(7);
    expect(abort.getTranscriptFreezeCount()).toBe(7);

    abort.resetForSessionChange();

    expect(abort.getTranscriptFreezeCount()).toBe(null);
    expect(abort.getAbortRetainPending()).toBe(false);
    expect(abort.getUiRunning()).toBe(false);
    expect(onStreamReset).toHaveBeenCalledTimes(1);
  });

  it('sessionId 为 undefined 时不调 abortRegistry.abort', () => {
    const abortRegistry = {abort: jest.fn(), has: jest.fn(() => false)};
    const api: {current?: UseSessionAbortResult} = {};
    const onStreamResetRef = {current: jest.fn()} as never;

    function Harness() {
      api.current = useSessionAbort({
        sessionId: undefined,
        abortRegistry: abortRegistry as never,
        onStreamResetRef,
      });
      return null;
    }
    act(() => {
      TestRenderer.create(React.createElement(Harness));
    });
    api.current!.abortUiRun();
    expect(abortRegistry.abort).not.toHaveBeenCalled();
  });
});
