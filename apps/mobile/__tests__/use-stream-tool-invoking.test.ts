import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {
  computeToolInvoking,
  useStreamToolInvoking,
} from '../src/hooks/useStreamToolInvoking';

describe('computeToolInvoking', () => {
  it('agent 未运行时为 false', () => {
    expect(
      computeToolInvoking({
        agentRunning: false,
        thinkingContent: 'plan',
        textContent: '',
        msSinceLastThinkingDelta: 500,
      }),
    ).toBe(false);
  });

  it('无 thinking 且无正文时为 false', () => {
    expect(
      computeToolInvoking({
        agentRunning: true,
        thinkingContent: '',
        textContent: '',
        msSinceLastThinkingDelta: 500,
      }),
    ).toBe(false);
  });

  it('thinking 空闲不足阈值为 false', () => {
    expect(
      computeToolInvoking({
        agentRunning: true,
        thinkingContent: 'plan',
        textContent: '',
        msSinceLastThinkingDelta: 100,
        idleThresholdMs: 300,
      }),
    ).toBe(false);
  });

  it('thinking 空闲 ≥300ms 且无正文时为 true', () => {
    expect(
      computeToolInvoking({
        agentRunning: true,
        thinkingContent: 'plan',
        textContent: '',
        msSinceLastThinkingDelta: 300,
      }),
    ).toBe(true);
  });

  it('有正文且 text 空闲不足阈值为 false', () => {
    expect(
      computeToolInvoking({
        agentRunning: true,
        thinkingContent: 'plan',
        textContent: 'hello',
        msSinceLastThinkingDelta: 500,
        msSinceLastTextDelta: 100,
        idleThresholdMs: 300,
      }),
    ).toBe(false);
  });

  it('有正文且 text 空闲 ≥300ms 时为 true（post-text 路径）', () => {
    expect(
      computeToolInvoking({
        agentRunning: true,
        thinkingContent: '',
        textContent: 'hello',
        msSinceLastThinkingDelta: 0,
        msSinceLastTextDelta: 300,
      }),
    ).toBe(true);
  });

  it('有正文且仍在流式输出时为 false', () => {
    expect(
      computeToolInvoking({
        agentRunning: true,
        thinkingContent: 'plan',
        textContent: 'hello',
        msSinceLastThinkingDelta: 500,
        msSinceLastTextDelta: 50,
        idleThresholdMs: 300,
      }),
    ).toBe(false);
  });
});

describe('useStreamToolInvoking', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('burst noteThinkingDelta does not setState until idle threshold crossed', () => {
    let renderCount = 0;

    function Harness() {
      const {noteThinkingDelta} = useStreamToolInvoking(true);
      renderCount += 1;
      React.useEffect(() => {
        noteThinkingDelta('a');
        noteThinkingDelta('b');
        noteThinkingDelta('c');
      }, [noteThinkingDelta]);
      return null;
    }

    act(() => {
      TestRenderer.create(React.createElement(Harness));
    });
    expect(renderCount).toBe(1);

    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(renderCount).toBe(1);

    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(renderCount).toBe(2);
  });

  it('post-text idle 后 toolInvoking 为 true', () => {
    let toolInvoking = false;
    let noteTextDelta: (delta: string) => void = () => undefined;

    function Harness() {
      const state = useStreamToolInvoking(true);
      toolInvoking = state.toolInvoking;
      noteTextDelta = state.noteTextDelta;
      return null;
    }

    act(() => {
      TestRenderer.create(React.createElement(Harness));
    });

    act(() => {
      noteTextDelta('正文');
    });
    expect(toolInvoking).toBe(false);

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(toolInvoking).toBe(true);
  });
});
