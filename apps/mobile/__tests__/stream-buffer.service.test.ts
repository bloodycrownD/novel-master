import {describe, expect, it, jest} from '@jest/globals';
import {createStreamBuffer} from '../src/services/stream-buffer.service';

describe('stream-buffer.service', () => {
  it('batches many deltas into throttled flushes', () => {
    jest.useFakeTimers();
    const textChunks: string[] = [];
    const thinkingChunks: string[] = [];
    const buffer = createStreamBuffer(
      {
        onTextFlush: chunk => textChunks.push(chunk),
        onThinkingFlush: chunk => thinkingChunks.push(chunk),
      },
      {flushIntervalMs: 50},
    );
    buffer.push('text', 'a');
    buffer.push('text', 'b');
    buffer.push('thinking', 'x');
    expect(textChunks).toEqual([]);
    jest.advanceTimersByTime(51);
    expect(textChunks).toEqual(['ab']);
    expect(thinkingChunks).toEqual(['x']);
    buffer.dispose();
    jest.useRealTimers();
  });

  it('drops thinking buffer on overflow but preserves text', () => {
    jest.useFakeTimers();
    const textChunks: string[] = [];
    const thinkingChunks: string[] = [];
    const buffer = createStreamBuffer(
      {
        onTextFlush: chunk => textChunks.push(chunk),
        onThinkingFlush: chunk => thinkingChunks.push(chunk),
      },
      {flushIntervalMs: 1_000, maxCharsPerBuffer: 5},
    );
    buffer.push('thinking', '1234');
    buffer.push('text', 'ab');
    jest.advanceTimersByTime(1_001);
    expect(textChunks).toEqual(['ab']);
    expect(thinkingChunks).toEqual([]);
    buffer.dispose();
    jest.useRealTimers();
  });
});
