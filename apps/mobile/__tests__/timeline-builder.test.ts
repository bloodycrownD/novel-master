import type {ChatMessage, SessionFsBatchSummary} from '@novel-master/core';
import {buildTimeline} from '../src/components/session-log/timeline-builder';

function msg(
  id: string,
  role: string,
  blocks: ChatMessage['content']['blocks'],
  createdAtMs: number,
): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq: createdAtMs,
    role,
    content: {blocks},
    provider: null,
    raw: null,
    createdAtMs,
    hidden: false,
  };
}

function batch(
  id: string,
  createdAtMs: number,
  createdBy = 'assistant',
): SessionFsBatchSummary {
  return {id, sessionId: 's1', createdAtMs, createdBy};
}

describe('timeline-builder', () => {
  it('merges tools and checkpoints newest-first', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{type: 'tool_use', id: 'tu1', name: 'vfs.read', input: {path: '/a'}}],
        1000,
      ),
      msg(
        'u1',
        'user',
        [{type: 'tool_result', toolUseId: 'tu1', content: 'ok'}],
        1100,
      ),
    ];
    const batches = [batch('b1', 1200)];
    const items = buildTimeline(messages, batches, {checkpointRetention: 100});
    expect(items.map(i => i.kind)).toEqual(['checkpoint', 'tool']);
    expect(items[0]?.kind === 'checkpoint' && items[0].batchId).toBe('b1');
  });

  it('marks tool success and error from tool_result', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{type: 'tool_use', id: 'tu1', name: 'vfs.write', input: {path: '/x'}}],
        2000,
      ),
      msg(
        'u1',
        'user',
        [{type: 'tool_result', toolUseId: 'tu1', content: 'Error: failed'}],
        2100,
      ),
      msg(
        'a2',
        'assistant',
        [{type: 'tool_use', id: 'tu2', name: 'vfs.read', input: {}}],
        3000,
      ),
    ];
    const items = buildTimeline(messages, [], {checkpointRetention: 100});
    const tools = items.filter(i => i.kind === 'tool');
    expect(tools).toHaveLength(2);
    expect(tools[0]?.kind === 'tool' && tools[0].status).toBe('pending');
    expect(tools[1]?.kind === 'tool' && tools[1].status).toBe('error');
  });

  it('marks batches beyond retention as expired', () => {
    const batches = [
      batch('old', 100),
      batch('mid', 200),
      batch('new', 300),
    ];
    const items = buildTimeline([], batches, {checkpointRetention: 2});
    const checkpoints = items.filter(i => i.kind === 'checkpoint');
    const old = checkpoints.find(
      c => c.kind === 'checkpoint' && c.batchId === 'old',
    );
    const mid = checkpoints.find(
      c => c.kind === 'checkpoint' && c.batchId === 'mid',
    );
    const newest = checkpoints.find(
      c => c.kind === 'checkpoint' && c.batchId === 'new',
    );
    expect(old?.kind === 'checkpoint' && old.expired).toBe(true);
    expect(mid?.kind === 'checkpoint' && mid.expired).toBe(false);
    expect(newest?.kind === 'checkpoint' && newest.expired).toBe(false);
  });

  it('honors mockExpiredBatchIds for tests', () => {
    const batches = [batch('b1', 1000)];
    const items = buildTimeline([], batches, {
      checkpointRetention: 100,
      mockExpiredBatchIds: new Set(['b1']),
    });
    expect(items[0]?.kind === 'checkpoint' && items[0].expired).toBe(true);
  });
});
