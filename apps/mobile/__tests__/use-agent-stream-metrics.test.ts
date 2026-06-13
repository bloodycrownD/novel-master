import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {
  buildChatStreamMetricsLine,
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

  it('freezeToLastRun 在 agent 仍 running 时冻结为上次生成', () => {
    act(() => {
      renderer = TestRenderer.create(React.createElement(Probe, {running: true}));
    });
    act(() => {
      api.noteToolUseDelta('{"path":"/a"}');
      api.freezeToLastRun();
    });
    expect(metrics).not.toBeNull();
    expect(metrics!.running).toBe(false);
    expect(metrics!.toolUseChars).toBe(13);
    expect(metrics!.streamKind).toBe('tool');
  });

  it('冻结后新一轮流式 delta 恢复 live metrics', () => {
    act(() => {
      renderer = TestRenderer.create(React.createElement(Probe, {running: true}));
    });
    act(() => {
      api.noteToolUseDelta('{}');
      api.freezeToLastRun();
    });
    expect(metrics!.running).toBe(false);
    act(() => {
      api.noteTextDelta('续写');
    });
    expect(metrics!.running).toBe(true);
    expect(metrics!.textChars).toBe(2);
    expect(metrics!.streamKind).toBe('text');
  });
});

describe('ChatStreamMetricsBar', () => {
  it('assistant 落库后展示上次生成而非工具调用生成中', () => {
    const line = buildChatStreamMetricsLine({
      running: false,
      streamKind: 'tool',
      toolUseChars: 1234,
      textChars: 0,
      thinkingChars: 0,
      elapsedMs: 5200,
      totalChars: 1234,
      charsPerSecond: 237,
    });
    expect(line).toContain('上次生成');
    expect(line).not.toContain('工具调用生成中');
    expect(line).toContain('工具参数');
  });

  it('mixed 且仅有思考+工具参数时运行中显示工具调用生成中', () => {
    const line = buildChatStreamMetricsLine({
      running: true,
      streamKind: 'mixed',
      toolUseChars: 42,
      textChars: 0,
      thinkingChars: 128,
      elapsedMs: 3000,
      totalChars: 170,
      charsPerSecond: 56.7,
    });
    expect(line).toContain('工具调用生成中');
    expect(line).not.toMatch(/^生成中/);
    expect(line).toContain('工具参数');
    expect(line).toContain('思考');
  });
});
