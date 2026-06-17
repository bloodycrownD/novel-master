import {
  USER_VFS_TURN_ACK_TEXT,
  wrapUserVfsActionsForStorage,
  type ChatMessage,
} from "@novel-master/core/chat";
import {
  buildChatListItems,
  buildToolResultByUseId,
  isTurnToolExecuting,
  messageHasToolUse,
  resolveToolResultsMessageId,
  toolCallViewFromUse,
  toolUseIdsFromMessage,
  turnToolResultsComplete,
  vfsToolFilePath,
} from '../src/components/chat/message-blocks';

function msg(
  id: string,
  role: string,
  blocks: ChatMessage['content']['blocks'],
  seq: number,
  hidden = false,
  raw: ChatMessage['raw'] = null,
): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq,
    role,
    content: {blocks},
    provider: null,
    raw,
    createdAtMs: seq,
    hidden,
  };
}

describe('message-blocks', () => {
  it('does not mark success read as error when file body contains "terrors"', () => {
    const ravenSnippet =
      'Thrilled me—filled me with fantastic terrors never felt before;';
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'read', input: {path: '/poem.txt'}},
      ], 1),
      msg('u1', 'user', [
        {
          type: 'tool_result',
          toolUseId: 'tu1',
          content: JSON.stringify(
            {path: '/poem.txt', content: ravenSnippet, truncated: false},
            null,
            2,
          ),
        },
      ], 2),
    ];
    const items = buildChatListItems(messages);
    if (items[0]?.kind === 'message') {
      expect(items[0].tools[0]?.status).toBe('success');
    }
  });

  it('R5: ok true with terrors in content shows success card', () => {
    const ravenSnippet =
      'Thrilled me—filled me with fantastic terrors never felt before;';
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'read', input: {path: '/poem.txt'}},
      ], 1),
      msg('u1', 'user', [
        {
          type: 'tool_result',
          toolUseId: 'tu1',
          ok: true,
          content: JSON.stringify(
            {path: '/poem.txt', content: ravenSnippet, truncated: false},
            null,
            2,
          ),
        },
      ], 2),
    ];
    const items = buildChatListItems(messages);
    if (items[0]?.kind === 'message') {
      expect(items[0].tools[0]?.status).toBe('success');
    }
  });

  it('R6: legacy tool_result without ok uses Error: prefix for status', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'read', input: {path: '/ok.txt'}},
      ], 1),
      msg('u1', 'user', [
        {type: 'tool_result', toolUseId: 'tu1', content: 'file body'},
      ], 2),
    ];
    const items = buildChatListItems(messages);
    if (items[0]?.kind === 'message') {
      expect(items[0].tools[0]?.status).toBe('success');
    }

    const errorMessages = [
      msg('a2', 'assistant', [
        {type: 'tool_use', id: 'tu2', name: 'read', input: {path: '/missing'}},
      ], 3),
      msg('u2', 'user', [
        {
          type: 'tool_result',
          toolUseId: 'tu2',
          content: 'Error: Path not found: /missing',
        },
      ], 4),
    ];
    const errorItems = buildChatListItems(errorMessages);
    if (errorItems[0]?.kind === 'message') {
      expect(errorItems[0].tools[0]?.status).toBe('error');
    }
  });

  it('marks tool_result starting with Error: as error', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'read', input: {path: '/missing'}},
      ], 1),
      msg('u1', 'user', [
        {
          type: 'tool_result',
          toolUseId: 'tu1',
          content: 'Error: Path not found: /missing',
        },
      ], 2),
    ];
    const items = buildChatListItems(messages);
    if (items[0]?.kind === 'message') {
      expect(items[0].tools[0]?.status).toBe('error');
    }
  });

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

  it('orphan tool_use without result → pending tool cards', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'list', input: {}},
      ], 1),
    ];
    const items = buildChatListItems(messages, {agentRunning: false});
    expect(items).toHaveLength(1);
    if (items[0]?.kind === 'message') {
      expect(items[0].tools).toHaveLength(1);
      expect(items[0].tools[0]?.status).toBe('pending');
    }
  });

  it('tool executing → pending cards when agentRunning', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'list', input: {}},
      ], 1),
    ];
    const items = buildChatListItems(messages, {agentRunning: true});
    if (items[0]?.kind === 'message') {
      expect(items[0].tools).toHaveLength(1);
      expect(items[0].tools[0]?.status).toBe('pending');
    }
  });

  it('tool complete → terminal tool cards', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'list', input: {}},
      ], 1),
      msg('u1', 'user', [
        {type: 'tool_result', toolUseId: 'tu1', content: 'ok'},
      ], 2),
    ];
    const items = buildChatListItems(messages, {agentRunning: true});
    if (items[0]?.kind === 'message') {
      expect(items[0].tools).toHaveLength(1);
      expect(items[0].tools[0]?.status).toBe('success');
    }
  });

  it('incomplete turns always render pending tool cards', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'read', input: {}},
      ], 1),
      msg('a2', 'assistant', [
        {type: 'tool_use', id: 'tu2', name: 'list', input: {}},
      ], 2),
    ];
    const items = buildChatListItems(messages, {agentRunning: true});
    const byId = new Map(
      items.filter(i => i.kind === 'message').map(i => [i.message.id, i]),
    );
    expect(byId.get('a1')?.tools[0]?.status).toBe('pending');
    expect(byId.get('a2')?.tools[0]?.status).toBe('pending');
  });

  it('turnToolResultsComplete detects paired results', () => {
    const assistant = msg('a1', 'assistant', [
      {type: 'tool_use', id: 'tu1', name: 'read', input: {}},
    ], 1);
    const incomplete = [assistant];
    const complete = [
      assistant,
      msg('u1', 'user', [
        {type: 'tool_result', toolUseId: 'tu1', content: 'ok'},
      ], 2),
    ];
    expect(turnToolResultsComplete(assistant, incomplete)).toBe(false);
    expect(turnToolResultsComplete(assistant, complete)).toBe(true);
  });

  it('isTurnToolExecuting requires agentRunning', () => {
    const assistant = msg('a1', 'assistant', [
      {type: 'tool_use', id: 'tu1', name: 'read', input: {}},
    ], 1);
    expect(isTurnToolExecuting(assistant, [assistant], false)).toBe(false);
    expect(isTurnToolExecuting(assistant, [assistant], true)).toBe(true);
  });

  it('merges 3 tool_use into one assistant message item when complete', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu1', name: 'vfs.read', input: {path: '/a'}},
        {type: 'tool_use', id: 'tu2', name: 'vfs.list', input: {}},
        {type: 'tool_use', id: 'tu3', name: 'vfs.write', input: {path: '/b'}},
      ], 1),
      msg('u1', 'user', [
        {type: 'tool_result', toolUseId: 'tu1', content: 'a'},
        {type: 'tool_result', toolUseId: 'tu2', content: 'b'},
        {type: 'tool_result', toolUseId: 'tu3', content: 'c'},
      ], 2),
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
      msg('u2', 'user', [
        {type: 'tool_result', toolUseId: 'tu1', content: 'ok'},
      ], 3),
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

  it('hidden assistant with incomplete tools shows pending cards', () => {
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
      expect(items[0].tools[0]?.status).toBe('pending');
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
      msg('u1', 'user', [
        {type: 'tool_result', toolUseId: 'tu1', content: 'ok'},
      ], 2),
    ];
    const item = buildChatListItems(messages)[0];
    expect(item?.kind).toBe('message');
    if (item?.kind === 'message') {
      expect(item.thinkingParts).toEqual(['hmm']);
      expect(item.textParts).toEqual(['reply']);
      expect(item.tools).toHaveLength(1);
    }
  });

  it('vfsToolFilePath returns path for vfs read/write/edit only', () => {
    expect(
      vfsToolFilePath({
        toolUseId: 't1',
        name: 'edit',
        input: {path: '/续写/a.md'},
        status: 'success',
      }),
    ).toBe('/续写/a.md');
    expect(
      vfsToolFilePath({
        toolUseId: 't2',
        name: 'fs',
        input: {command: 'ls /'},
        status: 'success',
      }),
    ).toBeUndefined();
  });

  it('B2-4: UA 两段折叠为单个 user_vfs_turn', () => {
    const actionXml = '<user-vfs-action kind="delete" path="/a.md" />';
    const messages = [
      msg(
        'u1',
        'user',
        [{type: 'text', text: wrapUserVfsActionsForStorage(actionXml)}],
        1,
        false,
        {metadata: {kind: 'user_vfs_action', source: 'user', synthetic: true}},
      ),
      msg(
        'a1',
        'assistant',
        [{type: 'text', text: USER_VFS_TURN_ACK_TEXT}],
        2,
        false,
        {metadata: {kind: 'user_vfs_ack', synthetic: true}},
      ),
    ];
    const items = buildChatListItems(messages);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('user_vfs_turn');
    if (items[0]?.kind === 'user_vfs_turn') {
      expect(items[0].id).toBe('u1');
      expect(items[0].tools.length).toBe(1);
      expect(items[0].tools[0]?.status).toBe('success');
    }
  });

  it('B2-5: 旧四段 fixture 不产出 user_vfs_turn', () => {
    const messages = [
      msg(
        'u1',
        'user',
        [{type: 'text', text: '<user-vfs-action kind="delete" path="/a.md" />'}],
        1,
        false,
        {metadata: {kind: 'user_vfs_action', source: 'user', synthetic: true}},
      ),
      msg(
        'a1',
        'assistant',
        [{type: 'tool_use', id: 'tu1', name: 'fs', input: {command: '…'}}],
        2,
        false,
        {metadata: {synthetic: true, actor: 'user', toolInputCompressed: true}},
      ),
      msg(
        'u2',
        'user',
        [{type: 'tool_result', toolUseId: 'tu1', content: 'ok', ok: true}],
        3,
        false,
        {metadata: {source: 'user', synthetic: true}},
      ),
      msg(
        'a2',
        'assistant',
        [{type: 'text', text: '【done】'}],
        4,
        false,
        {metadata: {kind: 'tool_turn_bridge', synthetic: true}},
      ),
    ];
    const items = buildChatListItems(messages);
    expect(items.every(i => i.kind !== 'user_vfs_turn')).toBe(true);
    expect(items.length).toBeGreaterThan(1);
  });
});
