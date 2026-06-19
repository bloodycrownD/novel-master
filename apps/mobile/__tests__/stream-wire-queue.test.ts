import {describe, expect, it} from '@jest/globals';
import {
  appendWireChunk,
  coalesceWireQueue,
  type StreamWireChunk,
} from '@/services/stream-wire-queue';

describe('stream-wire-queue', () => {
  it('think A → text B → think C 保序', () => {
    const queue: StreamWireChunk[] = [];
    appendWireChunk(queue, {kind: 'thinking', delta: 'A'});
    appendWireChunk(queue, {kind: 'text', delta: 'B'});
    appendWireChunk(queue, {kind: 'thinking', delta: 'C'});
    expect(queue).toEqual([
      {kind: 'thinking', delta: 'A'},
      {kind: 'text', delta: 'B'},
      {kind: 'thinking', delta: 'C'},
    ]);
  });

  it('相邻同 kind 合并', () => {
    const queue: StreamWireChunk[] = [];
    appendWireChunk(queue, {kind: 'text', delta: 'a'});
    appendWireChunk(queue, {kind: 'text', delta: 'b'});
    appendWireChunk(queue, {kind: 'thinking', delta: 'x'});
    appendWireChunk(queue, {kind: 'thinking', delta: 'y'});
    expect(queue).toEqual([
      {kind: 'text', delta: 'ab'},
      {kind: 'thinking', delta: 'xy'},
    ]);
  });

  it('coalesceWireQueue 不跨 kind 重排', () => {
    const input: StreamWireChunk[] = [
      {kind: 'thinking', delta: 'a'},
      {kind: 'text', delta: 'b'},
      {kind: 'thinking', delta: 'c'},
    ];
    expect(coalesceWireQueue(input)).toEqual(input);
  });

  it('忽略空 delta', () => {
    const queue: StreamWireChunk[] = [];
    appendWireChunk(queue, {kind: 'text', delta: ''});
    expect(queue).toEqual([]);
  });
});
