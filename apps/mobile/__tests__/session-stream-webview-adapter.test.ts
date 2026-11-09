/**
 * 单元流式句柄 → ChatTranscriptWebView handle 适配器测试（T-SP21）。
 *
 * 断言适配器三个映射：
 * - stream-batch → pushStream({streamId, segments, tools})，streamId 原样
 *   透传（不猜宿主当前 id）；
 * - reset-stream → resetStream(streamIds) 透传；
 * - force-snapshot → forceSnapshot。
 * 另断言旧 stream-delta 分支已删、未知载荷被忽略。
 */
import {describe, expect, it, jest} from '@jest/globals';
import {createTranscriptStreamHandle} from '@/services/session-stream-webview-adapter';

function createWebHandle() {
  const pushStream = jest.fn();
  const resetStream = jest.fn();
  const forceSnapshot = jest.fn();
  return {
    web: {pushStream, resetStream, forceSnapshot} as never,
    pushStream,
    resetStream,
    forceSnapshot,
  };
}

describe('session-stream-webview-adapter 三映射（T-SP21）', () => {
  it('stream-batch → pushStream：streamId 与 segments/tools 原样透传', () => {
    const w = createWebHandle();
    const handle = createTranscriptStreamHandle('h', w.web);
    const tools = [
      {toolUseId: 't1', name: 'read', input: {}, status: 'pending'},
    ];

    handle.onStreamPayload?.({
      type: 'stream-batch',
      streamId: 'st:s:9:3',
      segments: [{kind: 'text', delta: 'abc'}],
      tools,
    });

    expect(w.pushStream).toHaveBeenCalledTimes(1);
    expect(w.pushStream).toHaveBeenCalledWith({
      streamId: 'st:s:9:3',
      segments: [{kind: 'text', delta: 'abc'}],
      tools,
    });
  });

  it('streamId 原样透传：适配器不使用宿主当前 id 猜测', () => {
    const w = createWebHandle();
    const handle = createTranscriptStreamHandle('h', w.web);

    handle.onStreamPayload?.({
      type: 'stream-batch',
      streamId: 'st:other:1:0',
      segments: [],
    });

    expect(w.pushStream).toHaveBeenCalledWith({
      streamId: 'st:other:1:0',
      segments: [],
      tools: undefined,
    });
  });

  it('已删除的 stream-delta 旧载荷被忽略（不再有第二条通道）', () => {
    const w = createWebHandle();
    const handle = createTranscriptStreamHandle('h', w.web);

    handle.onStreamPayload?.({type: 'stream-delta', kind: 'text', delta: 'x'});
    handle.onStreamPayload?.({type: 'stream-batch'});
    handle.onStreamPayload?.(null);

    expect(w.pushStream).not.toHaveBeenCalled();
  });

  it('reset-stream → resetStream(streamIds) 透传', () => {
    const w = createWebHandle();
    const handle = createTranscriptStreamHandle('h', w.web);

    handle.onControlMessage?.({
      type: 'reset-stream',
      streamIds: ['st:s:9:1', 'st:s:9:2'],
    });

    expect(w.resetStream).toHaveBeenCalledWith(['st:s:9:1', 'st:s:9:2']);
  });

  it('force-snapshot → forceSnapshot；未知控制消息忽略', () => {
    const w = createWebHandle();
    const handle = createTranscriptStreamHandle('h', w.web);

    handle.onControlMessage?.({type: 'force-snapshot'});
    handle.onControlMessage?.({type: 'unknown'});
    handle.onControlMessage?.({type: 'reset-stream'});

    expect(w.forceSnapshot).toHaveBeenCalledTimes(1);
    expect(w.resetStream).not.toHaveBeenCalled();
  });
});
