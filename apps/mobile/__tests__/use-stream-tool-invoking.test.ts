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

  it('无 thinking 时为 false', () => {
    expect(
      computeToolInvoking({
        agentRunning: true,
        thinkingContent: '',
        textContent: '',
        msSinceLastThinkingDelta: 500,
      }),
    ).toBe(false);
  });

  it('已有正文时为 false', () => {
    expect(
      computeToolInvoking({
        agentRunning: true,
        thinkingContent: 'plan',
        textContent: 'hello',
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
});
