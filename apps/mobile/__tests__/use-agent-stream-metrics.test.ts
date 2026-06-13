import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {
  computeStreamKind,
  formatCharCount,
  formatStreamElapsed,
  useAgentStreamMetrics,
  type AgentStreamMetricsView,
} from '../src/hooks/useAgentStreamMetrics';

describe('useAgentStreamMetrics formatters', () => {
  it('formatStreamElapsed uses one decimal under 60s', () => {
    expect(formatStreamElapsed(12.34)).toBe('12.3s');
    expect(formatStreamElapsed(90)).toBe('90s');
  });

  it('formatCharCount uses zh-CN grouping', () => {
    expect(formatCharCount(1234)).toMatch(/1/);
    expect(formatCharCount(1234).length).toBeGreaterThan(3);
  });
});

describe('computeStreamKind', () => {
  it('returns text when only body/thinking chars exist', () => {
    expect(
      computeStreamKind({textChars: 10, thinkingChars: 0, toolUseChars: 0}),
    ).toBe('text');
    expect(
      computeStreamKind({textChars: 0, thinkingChars: 5, toolUseChars: 0}),
    ).toBe('text');
  });

  it('returns tool when only tool param chars exist', () => {
    expect(
      computeStreamKind({textChars: 0, thinkingChars: 0, toolUseChars: 42}),
    ).toBe('tool');
  });

  it('returns mixed when both content and tool chars exist', () => {
    expect(
      computeStreamKind({textChars: 3, thinkingChars: 0, toolUseChars: 7}),
    ).toBe('mixed');
    expect(
      computeStreamKind({textChars: 0, thinkingChars: 2, toolUseChars: 1}),
    ).toBe('mixed');
  });
});

describe('useAgentStreamMetrics hook', () => {
  let api: ReturnType<typeof useAgentStreamMetrics>;
  let metrics: AgentStreamMetricsView | null = null;
  let renderer: TestRenderer.ReactTestRenderer;

  function Probe({running}: {running: boolean}) {
    api = useAgentStreamMetrics(running);
    metrics = api.metrics;
    return null;
  }

  afterEach(() => {
    if (renderer != null) {
      act(() => {
        renderer.unmount();
      });
    }
  });

  it('noteToolUseDelta accumulates tool chars and sets streamKind', () => {
    act(() => {
      renderer = TestRenderer.create(React.createElement(Probe, {running: true}));
    });
    act(() => {
      api.noteToolUseDelta('{"path":');
      api.noteToolUseDelta('"/tmp/a"}');
    });
    act(() => {
      renderer.update(React.createElement(Probe, {running: false}));
    });
    expect(metrics).not.toBeNull();
    expect(metrics!.toolUseChars).toBe(17);
    expect(metrics!.streamKind).toBe('tool');
    expect(metrics!.totalChars).toBe(17);
  });

  it('noteToolUseDelta with text deltas yields mixed streamKind', () => {
    act(() => {
      renderer = TestRenderer.create(React.createElement(Probe, {running: true}));
    });
    act(() => {
      api.noteTextDelta('hello');
      api.noteToolUseDelta('{}');
    });
    act(() => {
      renderer.update(React.createElement(Probe, {running: false}));
    });
    expect(metrics!.textChars).toBe(5);
    expect(metrics!.toolUseChars).toBe(2);
    expect(metrics!.streamKind).toBe('mixed');
    expect(metrics!.totalChars).toBe(7);
  });
});
