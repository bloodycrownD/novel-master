import {describe, expect, it, jest} from '@jest/globals';
import {createStreamApplyBuffer} from '@/services/stream-apply-buffer';

describe('stream-apply-buffer', () => {
  it('64ms 后按 FIFO flush', () => {
    jest.useFakeTimers();
    const flushed: string[][] = [];
    const buffer = createStreamApplyBuffer(
      segments => {
        flushed.push(segments.map(s => `${s.kind}:${s.delta}`));
      },
      {flushIntervalMs: 64},
    );
    buffer.push({kind: 'thinking', delta: 'A'});
    buffer.push({kind: 'text', delta: 'B'});
    expect(flushed).toEqual([]);
    jest.advanceTimersByTime(64);
    expect(flushed).toEqual([['thinking:A', 'text:B']]);
    buffer.dispose();
    jest.useRealTimers();
  });

  it('溢出强制 flush 且不丢弃 thinking', () => {
    jest.useFakeTimers();
    const flushed: string[][] = [];
    const buffer = createStreamApplyBuffer(
      segments => {
        flushed.push(segments.map(s => `${s.kind}:${s.delta}`));
      },
      {flushIntervalMs: 10_000, maxCharsPerBuffer: 5},
    );
    buffer.push({kind: 'thinking', delta: '1234'});
    buffer.push({kind: 'text', delta: 'ab'});
    expect(flushed.length).toBe(1);
    expect(flushed[0]).toEqual(['thinking:1234', 'text:ab']);
    buffer.dispose();
    jest.useRealTimers();
  });

  it('reset 丢弃未 flush 队列', () => {
    jest.useFakeTimers();
    const flushed: string[][] = [];
    const buffer = createStreamApplyBuffer(segments => {
      flushed.push(segments.map(s => s.delta));
    });
    buffer.push({kind: 'text', delta: 'x'});
    buffer.reset();
    jest.advanceTimersByTime(64);
    expect(flushed).toEqual([]);
    buffer.dispose();
    jest.useRealTimers();
  });
});
