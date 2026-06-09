import type {ChatMessage} from '@novel-master/core';
import {
  buildChatListItems,
  buildToolResultByUseId,
  messageHasToolUse,
  resolveToolResultsMessageId,
  toolCallViewFromUse,
  toolUseIdsFromMessage,
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
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('message');
    if (items[0]?.kind === 'message') {
      expect(items[0].tools).toHaveLength(1);
      expect(items[0].tools[0]?.status).toBe('pending');
    }
  });

  it('merges 3 tool_use into one assistant message item', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'vfs.read', input: {path: '/a'}},
        {type: 'tool_use', id: 'tu2', name: 'vfs.list', input: {}},
        {type: 'tool_use', id: 'tu3', name: 'vfs.write', input: {path: '/b'}},
      ], 1),
    ];
    const items = buildChatListItems(messages);
    expect(items).toHaveLength(1);
    if (items[0]?.kind === 'message') {
      expect(items[0].tools).toHaveLength(3);
    }
  });

  it('emits text bubbles with embedded tools (no standalone tool rows)', () => {
    const messages = [
      msg('u1', 'user', [{type: 'text', text: 'hi'}], 1),
      msg('a1', 'assistant', [
        {type: 'text', text: 'hello'},
        {type: 'tool_use', id: 'tu1', name: 'read', input: {path: '/x'}},
      ], 2),
    ];
    const items = buildChatListItems(messages);
    expect(items.map(i => i.kind)).toEqual(['message', 'message']);
    if (items[1]?.kind === 'message') {
      expect(items[1].tools).toHaveLength(1);
    }
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
    expect(map.get('tu1')?.content).toBe('ok');
    if (items[0]?.kind === 'message') {
      expect(items[0].tools[0]?.status).toBe('success');
    }
  });

  it('keeps hidden assistant tool turns as message rows with embedded tools', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{type: 'tool_use', id: 'tu1', name: 'vfs.list', input: {}}],
        1,
        true,
      ),
    ];
    const items = buildChatListItems(messages);
    expect(items).toHaveLength(1);
    if (items[0]?.kind === 'message') {
      expect(items[0].message.hidden).toBe(true);
      expect(items[0].tools).toHaveLength(1);
    }
  });

  it('omits tool_results-only user messages from list', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'vfs.read', input: {}},
      ], 1),
      msg('u1', 'user', [
        {type: 'tool_result', toolUseId: 'tu1', content: 'ok'},
      ], 2),
    ];
    const items = buildChatListItems(messages);
    expect(items).toHaveLength(1);
    expect(items[0]?.message.id).toBe('a1');
  });

  it('resolveToolResultsMessageId pairs adjacent assistant and user', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'vfs.read', input: {}},
        {type: 'tool_use', id: 'tu2', name: 'vfs.list', input: {}},
      ], 1),
      msg('u1', 'user', [
        {type: 'tool_result', toolUseId: 'tu1', content: 'a'},
        {type: 'tool_result', toolUseId: 'tu2', content: 'b'},
      ], 2),
    ];
    const assistant = messages[0]!;
    expect(toolUseIdsFromMessage(assistant)).toEqual(['tu1', 'tu2']);
    expect(messageHasToolUse(assistant)).toBe(true);
    expect(resolveToolResultsMessageId(messages, assistant)).toBe('u1');
  });

  it('resolveToolResultsMessageId skips non-matching later user messages', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'vfs.read', input: {}},
      ], 1),
      msg('u1', 'user', [{type: 'text', text: 'hi'}], 2),
      msg('u2', 'user', [
        {type: 'tool_result', toolUseId: 'tu1', content: 'ok'},
      ], 3),
    ];
    expect(resolveToolResultsMessageId(messages, messages[0]!)).toBe('u2');
  });

  it('buildChatListItems keeps thinking, text, then tools block order', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'thinking', text: 'hmm'},
        {type: 'text', text: 'reply'},
        {type: 'tool_use', id: 'tu1', name: 'read', input: {path: '/a'}},
      ], 1),
    ];
    const item = buildChatListItems(messages)[0];
    expect(item?.kind).toBe('message');
    if (item?.kind === 'message') {
      expect(item.thinkingParts).toEqual(['hmm']);
      expect(item.textParts).toEqual(['reply']);
      expect(item.tools).toHaveLength(1);
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
