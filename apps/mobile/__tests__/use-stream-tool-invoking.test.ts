import {computeToolInvoking} from '../src/hooks/useStreamToolInvoking';

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
