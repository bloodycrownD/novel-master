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
});
