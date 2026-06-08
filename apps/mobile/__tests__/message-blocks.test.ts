import type {ChatMessage} from '@novel-master/core';
import {
  buildChatListItems,
  buildToolResultByUseId,
  toolCallViewFromUse,
  vfsToolFilePath,
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

describe('message-blocks', () => {
  it('pairs tool_result with tool_use id', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'read', input: {path: '/a'}},
      ], 1),
      msg('u1', 'user', [
        {type: 'tool_result', toolUseId: 'tu1', content: 'ok'},
      ], 2),
    ];
    const map = buildToolResultByUseId(messages);
    const view = toolCallViewFromUse(
      {type: 'tool_use', id: 'tu1', name: 'read', input: {path: '/a'}},
      map,
    );
    expect(view.status).toBe('success');
    expect(view.resultContent).toBe('ok');
  });

  it('marks pending tool_use without result', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'list', input: {}},
      ], 1),
    ];
    const items = buildChatListItems(messages);
    const tool = items.find(i => i.kind === 'tool');
    expect(tool?.kind).toBe('tool');
    if (tool?.kind === 'tool') {
      expect(tool.tool.status).toBe('pending');
    }
  });

  it('emits text bubbles and tool cards in order', () => {
    const messages = [
      msg('u1', 'user', [{type: 'text', text: 'hi'}], 1),
      msg('a1', 'assistant', [
        {type: 'text', text: 'hello'},
        {type: 'tool_use', id: 'tu1', name: 'read', input: {path: '/x'}},
      ], 2),
    ];
    const items = buildChatListItems(messages);
    expect(items.map(i => i.kind)).toEqual(['message', 'message', 'tool']);
  });

  it('keeps hidden text messages in chat list items', () => {
    const messages = [
      msg('u1', 'user', [{type: 'text', text: 'visible'}], 1),
      msg('u2', 'user', [{type: 'text', text: 'hidden row'}], 2, true),
    ];
    const items = buildChatListItems(messages);
    expect(items).toHaveLength(2);
    expect(items.every(i => i.kind === 'message')).toBe(true);
    if (items[1]?.kind === 'message') {
      expect(items[1].message.hidden).toBe(true);
    }
  });

  it('pairs tool_result on hidden user messages for tool card status', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'read', input: {path: '/a'}},
      ], 1),
      msg(
        'u1',
        'user',
        [{type: 'tool_result', toolUseId: 'tu1', content: 'ok'}],
        2,
        true,
      ),
    ];
    const map = buildToolResultByUseId(messages);
    const items = buildChatListItems(messages);
    const tool = items.find(i => i.kind === 'tool');
    expect(map.get('tu1')?.content).toBe('ok');
    if (tool?.kind === 'tool') {
      expect(tool.tool.status).toBe('success');
    }
  });

  it('vfsToolFilePath returns path for vfs read/write/replace only', () => {
    expect(
      vfsToolFilePath({
        toolUseId: 't1',
        name: 'replace',
        input: {path: '/续写/a.md'},
        status: 'success',
      }),
    ).toBe('/续写/a.md');
    expect(
      vfsToolFilePath({
        toolUseId: 't2',
        name: 'list',
        input: {path: '/'},
        status: 'success',
      }),
    ).toBeUndefined();
  });
});
