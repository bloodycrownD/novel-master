import {describe, expect, it} from '@jest/globals';
import {type StreamWireChunk, StreamWireQueue} from '@/services/stream-wire-queue'

describe('stream-wire-queue', () => {
  it('think A → text B → think C 保序', () => {
    const queue: StreamWireChunk[] = [];
    StreamWireQueue.append(queue, {kind: 'thinking', delta: 'A'});
    StreamWireQueue.append(queue, {kind: 'text', delta: 'B'});
    StreamWireQueue.append(queue, {kind: 'thinking', delta: 'C'});
    expect(queue).toEqual([
      {kind: 'thinking', delta: 'A'},
      {kind: 'text', delta: 'B'},
      {kind: 'thinking', delta: 'C'},
    ]);
  });

  it('相邻同 kind 合并', () => {
    const queue: StreamWireChunk[] = [];
    StreamWireQueue.append(queue, {kind: 'text', delta: 'a'});
    StreamWireQueue.append(queue, {kind: 'text', delta: 'b'});
    StreamWireQueue.append(queue, {kind: 'thinking', delta: 'x'});
    StreamWireQueue.append(queue, {kind: 'thinking', delta: 'y'});
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
    expect(StreamWireQueue.coalesce(input)).toEqual(input);
  });

  it('忽略空 delta', () => {
    const queue: StreamWireChunk[] = [];
    StreamWireQueue.append(queue, {kind: 'text', delta: ''});
    expect(queue).toEqual([]);
  });
});
