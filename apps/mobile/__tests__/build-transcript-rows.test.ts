import { type ChatMessage } from "@novel-master/core/chat";
import {
  buildChatListItems,
  buildTranscriptRows,
  selectTailTranscriptRows,
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

  it('appends stream tail row when streaming (text/thinking only)', () => {
    const messages = [msg('u1', 'user', [{type: 'text', text: 'q'}], 1)];
    const rows = buildTranscriptRows(messages, {text: 'partial', thinking: ''});
    expect(rows[rows.length - 1]).toEqual({
      kind: 'stream',
      text: 'partial',
      thinking: '',
    });
  });

  it('stream tail never includes tools', () => {
    const messages = [msg('u1', 'user', [{type: 'text', text: 'q'}], 1)];
    const rows = buildTranscriptRows(messages, {
      text: 'partial',
      thinking: 'hmm',
    });
    const tail = rows[rows.length - 1];
    expect(tail).toMatchObject({
      kind: 'stream',
      text: 'partial',
      thinking: 'hmm',
    });
    expect(tail).not.toHaveProperty('tools');
  });

  it('maps pending tools on message rows when incomplete', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'read', input: {}},
      ], 1),
    ];
    const row = buildTranscriptRows(messages, undefined, {agentRunning: true})[0];
    expect(row).toMatchObject({
      kind: 'message',
      id: 'a1',
      tools: [expect.objectContaining({toolUseId: 'tu1', status: 'pending'})],
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

  it('embeds tools on message rows (no kind:tool)', () => {
    const messages = [
      msg('u1', 'user', [{type: 'text', text: 'hi'}], 1),
      msg('a1', 'assistant', [
        {type: 'text', text: 'hello'},
        {type: 'tool_use', id: 'tu1', name: 'read', input: {path: '/x'}},
      ], 2),
      msg('u2', 'user', [
        {type: 'tool_result', toolUseId: 'tu1', content: 'ok'},
      ], 3),
    ];
    const rows = buildTranscriptRows(messages);
    expect(rows.every(r => r.kind !== 'tool')).toBe(true);
    const assistant = rows.find(r => r.kind === 'message' && r.id === 'a1');
    expect(assistant).toMatchObject({
      kind: 'message',
      id: 'a1',
      tools: [
        expect.objectContaining({
          toolUseId: 'tu1',
          name: 'read',
          status: 'success',
          input: {path: '/x'},
          resultContent: 'ok',
        }),
      ],
    });
  });

  it('includes embedded tools on hidden assistant rows when complete', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{type: 'tool_use', id: 'tu1', name: 'list', input: {}}],
        1,
        true,
      ),
      msg('u1', 'user', [
        {type: 'tool_result', toolUseId: 'tu1', content: 'ok'},
      ], 2),
    ];
    const rows = buildTranscriptRows(messages);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'message',
      hidden: true,
      tools: [expect.objectContaining({toolUseId: 'tu1'})],
    });
  });

  it('maps hidden flag on message rows', () => {
    const messages = [
      msg('u1', 'user', [{type: 'text', text: 'hidden'}], 1, true),
    ];
    const row = buildTranscriptRows(messages)[0];
    expect(row).toMatchObject({kind: 'message', hidden: true});
  });

  it('selectTailTranscriptRows 需全量上下文：hidden tool_result 已配对时显示 success 工具卡', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'read', input: {}},
      ], 1),
      msg(
        'u1',
        'user',
        [{type: 'tool_result', toolUseId: 'tu1', content: 'ok'}],
        2,
        true,
      ),
    ];
    const tailOnly = buildTranscriptRows([messages[0]!], undefined, {
      agentRunning: true,
    })[0];
    const fromFull = selectTailTranscriptRows(messages, [messages[0]!], {
      agentRunning: true,
    })[0];
    expect(tailOnly).toMatchObject({
      tools: [expect.objectContaining({toolUseId: 'tu1', status: 'pending'})],
    });
    expect(fromFull).toMatchObject({
      tools: [expect.objectContaining({toolUseId: 'tu1', status: 'success'})],
    });
  });
});
