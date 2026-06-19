import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useStreamToolInvokingDisplay} from '@/hooks/useStreamToolInvokingDisplay';

describe('useStreamToolInvokingDisplay', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function mountDisplay(agentRunning = true) {
    let toolInvoking = false;
    let heuristicOn = false;
    let toolUseLatched = false;
    let noteTextDelta: (delta: string) => void = () => undefined;
    let noteThinkingDelta: (delta: string) => void = () => undefined;
    let latchToolUse: () => void = () => undefined;
    let clearToolUseLatch: () => void = () => undefined;
    let resetAll: () => void = () => undefined;

    function Harness() {
      const state = useStreamToolInvokingDisplay(agentRunning);
      toolInvoking = state.toolInvoking;
      heuristicOn = state.heuristicOn;
      toolUseLatched = state.toolUseLatched;
      noteTextDelta = state.noteTextDelta;
      noteThinkingDelta = state.noteThinkingDelta;
      latchToolUse = state.latchToolUse;
      clearToolUseLatch = state.clearToolUseLatch;
      resetAll = state.resetAll;
      return null;
    }

    act(() => {
      TestRenderer.create(React.createElement(Harness));
    });

    return {
      get toolInvoking() {
        return toolInvoking;
      },
      get heuristicOn() {
        return heuristicOn;
      },
      get toolUseLatched() {
        return toolUseLatched;
      },
      noteTextDelta: (delta: string) => {
        act(() => {
          noteTextDelta(delta);
        });
      },
      noteThinkingDelta: (delta: string) => {
        act(() => {
          noteThinkingDelta(delta);
        });
      },
      latchToolUse: () => {
        act(() => {
          latchToolUse();
        });
      },
      clearToolUseLatch: () => {
        act(() => {
          clearToolUseLatch();
        });
      },
      resetAll: () => {
        act(() => {
          resetAll();
        });
      },
    };
  }

  it('仅 TOOL_USE latch、heuristic false 时 toolInvoking 为 true', () => {
    const display = mountDisplay(true);
    display.latchToolUse();
    expect(display.toolInvoking).toBe(true);
    expect(display.heuristicOn).toBe(false);
    expect(display.toolUseLatched).toBe(true);
  });

  it('heuristic 闪灭 + latch true 时横条仍亮', () => {
    const display = mountDisplay(true);
    display.noteThinkingDelta('plan');
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(display.heuristicOn).toBe(true);
    display.latchToolUse();
    display.noteThinkingDelta('more');
    expect(display.heuristicOn).toBe(false);
    expect(display.toolInvoking).toBe(true);
  });

  it('首包正文清除 latch', () => {
    const display = mountDisplay(true);
    display.latchToolUse();
    expect(display.toolUseLatched).toBe(true);
    display.noteTextDelta('hello');
    display.clearToolUseLatch();
    expect(display.toolUseLatched).toBe(false);
    expect(display.toolInvoking).toBe(false);
  });

  it('resetAll 清除 latch 与启发式', () => {
    const display = mountDisplay(true);
    display.noteThinkingDelta('x');
    act(() => {
      jest.advanceTimersByTime(300);
    });
    display.latchToolUse();
    display.resetAll();
    expect(display.toolInvoking).toBe(false);
    expect(display.toolUseLatched).toBe(false);
  });

  it('agent 未运行时 toolInvoking 为 false', () => {
    const display = mountDisplay(false);
    display.latchToolUse();
    expect(display.toolInvoking).toBe(false);
  });
});
