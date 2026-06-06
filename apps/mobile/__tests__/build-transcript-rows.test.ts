import type {ChatMessage} from '@novel-master/core';
import {
  buildChatListItems,
  buildTranscriptRows,
} from '../src/components/chat/message-blocks';

function msg(
  id: string,
  role: string,
  blocks: ChatMessage['content']['blocks'],
  seq: number,
  hidden = false,
): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq,
    role,
    content: {blocks},
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden,
  };
}

describe('buildTranscriptRows', () => {
  it('matches buildChatListItems message order (seq ascending)', () => {
    const messages = [
      msg('u1', 'user', [{type: 'text', text: 'hi'}], 1),
      msg('a1', 'assistant', [{type: 'text', text: 'hello'}], 2),
    ];
    const listKinds = buildChatListItems(messages).map(i => i.kind);
    const rowKinds = buildTranscriptRows(messages).map(r => r.kind);
    expect(rowKinds).toEqual(listKinds);
  });

  it('appends stream tail row when streaming', () => {
    const messages = [msg('u1', 'user', [{type: 'text', text: 'q'}], 1)];
    const rows = buildTranscriptRows(messages, {text: 'partial', thinking: ''});
    expect(rows[rows.length - 1]).toEqual({
      kind: 'stream',
      text: 'partial',
      thinking: '',
    });
  });

  it('maps message fields for Web rows', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'text', text: 'reply'},
        {type: 'thinking', text: 'hmm'},
      ], 1),
    ];
    const row = buildTranscriptRows(messages)[0];
    expect(row).toMatchObject({
      kind: 'message',
      id: 'a1',
      role: 'assistant',
      text: 'reply',
      thinking: 'hmm',
    });
  });

  it('includes tool rows in same order as buildChatListItems', () => {
    const messages = [
      msg('u1', 'user', [{type: 'text', text: 'hi'}], 1),
      msg('a1', 'assistant', [
        {type: 'text', text: 'hello'},
        {type: 'tool_use', id: 'tu1', name: 'vfs.read', input: {path: '/x'}},
      ], 2),
      msg('u2', 'user', [
        {type: 'tool_result', toolUseId: 'tu1', content: 'ok'},
      ], 3),
    ];
    const listKinds = buildChatListItems(messages).map(i => i.kind);
    const rows = buildTranscriptRows(messages);
    expect(rows.map(r => r.kind)).toEqual(listKinds);
    const tool = rows.find(r => r.kind === 'tool');
    expect(tool).toMatchObject({
      kind: 'tool',
      toolUseId: 'tu1',
      name: 'vfs.read',
      status: 'success',
      input: {path: '/x'},
      resultContent: 'ok',
    });
  });

  it('omits tool cards for hidden assistant messages', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{type: 'tool_use', id: 'tu1', name: 'vfs.list', input: {}}],
        1,
        true,
      ),
    ];
    const rows = buildTranscriptRows(messages);
    expect(rows.every(r => r.kind !== 'tool')).toBe(true);
  });

  it('maps hidden flag on message rows', () => {
    const messages = [
      msg('u1', 'user', [{type: 'text', text: 'hidden'}], 1, true),
    ];
    const row = buildTranscriptRows(messages)[0];
    expect(row).toMatchObject({kind: 'message', hidden: true});
  });
});

