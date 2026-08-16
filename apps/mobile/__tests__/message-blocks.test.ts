import {
  USER_VFS_TURN_ACK_TEXT,
  wrapUserVfsActionsForStorage,
  type ChatMessage,
} from '@novel-master/core/chat';
import {
  buildChatListItems,
  buildToolResultByUseId,
  isTurnToolExecuting,
  messageHasToolUse,
  resolveToolResultsMessageId,
  skillToolRef,
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
    content: { blocks },
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
      msg(
        'a1',
        'assistant',
        [
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'read',
            input: { path: '/poem.txt' },
          },
        ],
        1,
      ),
      msg(
        'u1',
        'user',
        [
          {
            type: 'tool_result',
            toolUseId: 'tu1',
            content: JSON.stringify(
              { path: '/poem.txt', content: ravenSnippet, truncated: false },
              null,
              2,
            ),
          },
        ],
        2,
      ),
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
      msg(
        'a1',
        'assistant',
        [
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'read',
            input: { path: '/poem.txt' },
          },
        ],
        1,
      ),
      msg(
        'u1',
        'user',
        [
          {
            type: 'tool_result',
            toolUseId: 'tu1',
            ok: true,
            content: JSON.stringify(
              { path: '/poem.txt', content: ravenSnippet, truncated: false },
              null,
              2,
            ),
          },
        ],
        2,
      ),
    ];
    const items = buildChatListItems(messages);
    if (items[0]?.kind === 'message') {
      expect(items[0].tools[0]?.status).toBe('success');
    }
  });

  it('R6: legacy tool_result without ok uses Error: prefix for status', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'read',
            input: { path: '/ok.txt' },
          },
        ],
        1,
      ),
      msg(
        'u1',
        'user',
        [{ type: 'tool_result', toolUseId: 'tu1', content: 'file body' }],
        2,
      ),
    ];
    const items = buildChatListItems(messages);
    if (items[0]?.kind === 'message') {
      expect(items[0].tools[0]?.status).toBe('success');
    }

    const errorMessages = [
      msg(
        'a2',
        'assistant',
        [
          {
            type: 'tool_use',
            id: 'tu2',
            name: 'read',
            input: { path: '/missing' },
          },
        ],
        3,
      ),
      msg(
        'u2',
        'user',
        [
          {
            type: 'tool_result',
            toolUseId: 'tu2',
            content: 'Error: Path not found: /missing',
          },
        ],
        4,
      ),
    ];
    const errorItems = buildChatListItems(errorMessages);
    if (errorItems[0]?.kind === 'message') {
      expect(errorItems[0].tools[0]?.status).toBe('error');
    }
  });

  it('marks tool_result starting with Error: as error', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'read',
            input: { path: '/missing' },
          },
        ],
        1,
      ),
      msg(
        'u1',
        'user',
        [
          {
            type: 'tool_result',
            toolUseId: 'tu1',
            content: 'Error: Path not found: /missing',
          },
        ],
        2,
      ),
    ];
    const items = buildChatListItems(messages);
    if (items[0]?.kind === 'message') {
      expect(items[0].tools[0]?.status).toBe('error');
    }
  });

  it('pairs tool_result with tool_use id', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{ type: 'tool_use', id: 'tu1', name: 'read', input: { path: '/a' } }],
        1,
      ),
      msg(
        'u1',
        'user',
        [{ type: 'tool_result', toolUseId: 'tu1', content: 'ok' }],
        2,
      ),
    ];
    const map = buildToolResultByUseId(messages);
    const view = toolCallViewFromUse(
      { type: 'tool_use', id: 'tu1', name: 'read', input: { path: '/a' } },
      map,
    );
    expect(view.status).toBe('success');
    expect(view.resultContent).toBe('ok');
  });

  it('orphan tool_use without result → error when agent inactive', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{ type: 'tool_use', id: 'tu1', name: 'list', input: {} }],
        1,
      ),
    ];
    const items = buildChatListItems(messages, { agentRunning: false });
    expect(items).toHaveLength(1);
    if (items[0]?.kind === 'message') {
      expect(items[0].tools).toHaveLength(1);
      expect(items[0].tools[0]?.status).toBe('error');
    }
  });

  it('T-ARP-U1: 两工具 tu1 有 result、tu2 无 result + runUiStopped → tu1 success tu2 error', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'read',
            input: { path: '/a' },
          },
          { type: 'tool_use', id: 'tu2', name: 'list', input: {} },
        ],
        1,
      ),
      msg(
        'u1',
        'user',
        [{ type: 'tool_result', toolUseId: 'tu1', content: 'ok' }],
        2,
      ),
    ];
    const items = buildChatListItems(messages, { runUiStopped: true });
    if (items[0]?.kind === 'message') {
      expect(items[0].tools).toHaveLength(2);
      expect(items[0].tools[0]?.status).toBe('success');
      expect(items[0].tools[1]?.status).toBe('error');
    }
  });

  it('T-ARP-U2: runUiStopped 时 unpaired 工具标 error（即使 agentRunning）', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{ type: 'tool_use', id: 'tu1', name: 'list', input: {} }],
        1,
      ),
    ];
    const items = buildChatListItems(messages, {
      agentRunning: true,
      runUiStopped: true,
    });
    if (items[0]?.kind === 'message') {
      expect(items[0].tools[0]?.status).toBe('error');
    }
  });

  it('tool executing → pending cards when agentRunning', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{ type: 'tool_use', id: 'tu1', name: 'list', input: {} }],
        1,
      ),
    ];
    const items = buildChatListItems(messages, { agentRunning: true });
    if (items[0]?.kind === 'message') {
      expect(items[0].tools).toHaveLength(1);
      expect(items[0].tools[0]?.status).toBe('pending');
    }
  });

  it('tool complete → terminal tool cards', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{ type: 'tool_use', id: 'tu1', name: 'list', input: {} }],
        1,
      ),
      msg(
        'u1',
        'user',
        [{ type: 'tool_result', toolUseId: 'tu1', content: 'ok' }],
        2,
      ),
    ];
    const items = buildChatListItems(messages, { agentRunning: true });
    if (items[0]?.kind === 'message') {
      expect(items[0].tools).toHaveLength(1);
      expect(items[0].tools[0]?.status).toBe('success');
    }
  });

  it('incomplete turns: only last assistant pending when agentRunning', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{ type: 'tool_use', id: 'tu1', name: 'read', input: {} }],
        1,
      ),
      msg(
        'a2',
        'assistant',
        [{ type: 'tool_use', id: 'tu2', name: 'list', input: {} }],
        2,
      ),
    ];
    const items = buildChatListItems(messages, { agentRunning: true });
    const byId = new Map(
      items.filter(i => i.kind === 'message').map(i => [i.message.id, i]),
    );
    expect(byId.get('a1')?.tools[0]?.status).toBe('error');
    expect(byId.get('a2')?.tools[0]?.status).toBe('pending');
  });

  it('abort 后无 result 的工具卡不为执行中', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{ type: 'tool_use', id: 'tu1', name: 'read', input: {} }],
        1,
      ),
    ];
    const items = buildChatListItems(messages, { agentRunning: false });
    if (items[0]?.kind === 'message') {
      expect(items[0].tools[0]?.status).toBe('error');
      expect(items[0].tools[0]?.status).not.toBe('pending');
    }
  });

  it('turnToolResultsComplete detects paired results', () => {
    const assistant = msg(
      'a1',
      'assistant',
      [{ type: 'tool_use', id: 'tu1', name: 'read', input: {} }],
      1,
    );
    const incomplete = [assistant];
    const complete = [
      assistant,
      msg(
        'u1',
        'user',
        [{ type: 'tool_result', toolUseId: 'tu1', content: 'ok' }],
        2,
      ),
    ];
    expect(turnToolResultsComplete(assistant, incomplete)).toBe(false);
    expect(turnToolResultsComplete(assistant, complete)).toBe(true);
  });

  it('isTurnToolExecuting requires agentRunning', () => {
    const assistant = msg(
      'a1',
      'assistant',
      [{ type: 'tool_use', id: 'tu1', name: 'read', input: {} }],
      1,
    );
    expect(isTurnToolExecuting(assistant, [assistant], false)).toBe(false);
    expect(isTurnToolExecuting(assistant, [assistant], true)).toBe(true);
  });

  it('merges 3 tool_use into one assistant message item when complete', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'vfs.read',
            input: { path: '/a' },
          },
          { type: 'tool_use', id: 'tu2', name: 'vfs.list', input: {} },
          {
            type: 'tool_use',
            id: 'tu3',
            name: 'vfs.write',
            input: { path: '/b' },
          },
        ],
        1,
      ),
      msg(
        'u1',
        'user',
        [
          { type: 'tool_result', toolUseId: 'tu1', content: 'a' },
          { type: 'tool_result', toolUseId: 'tu2', content: 'b' },
          { type: 'tool_result', toolUseId: 'tu3', content: 'c' },
        ],
        2,
      ),
    ];
    const items = buildChatListItems(messages);
    expect(items).toHaveLength(1);
    if (items[0]?.kind === 'message') {
      expect(items[0].tools).toHaveLength(3);
    }
  });

  it('emits text bubbles with embedded tools (no standalone tool rows)', () => {
    const messages = [
      msg('u1', 'user', [{ type: 'text', text: 'hi' }], 1),
      msg(
        'a1',
        'assistant',
        [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 'tu1', name: 'read', input: { path: '/x' } },
        ],
        2,
      ),
      msg(
        'u2',
        'user',
        [{ type: 'tool_result', toolUseId: 'tu1', content: 'ok' }],
        3,
      ),
    ];
    const items = buildChatListItems(messages);
    expect(items.map(i => i.kind)).toEqual(['message', 'message']);
    if (items[1]?.kind === 'message') {
      expect(items[1].tools).toHaveLength(1);
    }
  });

  it('keeps hidden text messages in chat list items', () => {
    const messages = [
      msg('u1', 'user', [{ type: 'text', text: 'visible' }], 1),
      msg('u2', 'user', [{ type: 'text', text: 'hidden row' }], 2, true),
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
      msg(
        'a1',
        'assistant',
        [{ type: 'tool_use', id: 'tu1', name: 'read', input: { path: '/a' } }],
        1,
      ),
      msg(
        'u1',
        'user',
        [{ type: 'tool_result', toolUseId: 'tu1', content: 'ok' }],
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

  it('hidden assistant with incomplete tools shows error when agent inactive', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{ type: 'tool_use', id: 'tu1', name: 'vfs.list', input: {} }],
        1,
        true,
      ),
    ];
    const items = buildChatListItems(messages);
    expect(items).toHaveLength(1);
    if (items[0]?.kind === 'message') {
      expect(items[0].message.hidden).toBe(true);
      expect(items[0].tools).toHaveLength(1);
      expect(items[0].tools[0]?.status).toBe('error');
    }
  });

  it('T-SR3: 空正文 + attachments 仍进 buildChatListItems', () => {
    const emptyBodyWithAttach: ChatMessage = {
      ...msg('u-att', 'user', [{ type: 'text', text: '' }], 1),
      attachments: [
        {
          name: '/w.md',
          source: 'workplace',
          type: 'text',
          content: null,
          path: '/w.md',
        },
        {
          name: 'mkdir:/notes',
          source: 'user_ops',
          type: 'text',
          content: '<action name="mkdir">\n{"path":"/notes"}\n</action>',
        },
      ],
    };
    const items = buildChatListItems([emptyBodyWithAttach]);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('message');
    if (items[0]?.kind === 'message') {
      expect(items[0].textParts).toEqual([]);
      expect(items[0].message.attachments).toHaveLength(2);
      expect(items[0].message.attachments?.map(a => a.source)).toEqual([
        'workplace',
        'user_ops',
      ]);
    }
  });

  it('omits tool_results-only user messages from list', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{ type: 'tool_use', id: 'tu1', name: 'vfs.read', input: {} }],
        1,
      ),
      msg(
        'u1',
        'user',
        [{ type: 'tool_result', toolUseId: 'tu1', content: 'ok' }],
        2,
      ),
    ];
    const items = buildChatListItems(messages);
    expect(items).toHaveLength(1);
    expect(items[0]?.message.id).toBe('a1');
  });

  it('resolveToolResultsMessageId pairs adjacent assistant and user', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [
          { type: 'tool_use', id: 'tu1', name: 'vfs.read', input: {} },
          { type: 'tool_use', id: 'tu2', name: 'vfs.list', input: {} },
        ],
        1,
      ),
      msg(
        'u1',
        'user',
        [
          { type: 'tool_result', toolUseId: 'tu1', content: 'a' },
          { type: 'tool_result', toolUseId: 'tu2', content: 'b' },
        ],
        2,
      ),
    ];
    const assistant = messages[0]!;
    expect(toolUseIdsFromMessage(assistant)).toEqual(['tu1', 'tu2']);
    expect(messageHasToolUse(assistant)).toBe(true);
    expect(resolveToolResultsMessageId(messages, assistant)).toBe('u1');
  });

  it('resolveToolResultsMessageId skips non-matching later user messages', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [{ type: 'tool_use', id: 'tu1', name: 'vfs.read', input: {} }],
        1,
      ),
      msg('u1', 'user', [{ type: 'text', text: 'hi' }], 2),
      msg(
        'u2',
        'user',
        [{ type: 'tool_result', toolUseId: 'tu1', content: 'ok' }],
        3,
      ),
    ];
    expect(resolveToolResultsMessageId(messages, messages[0]!)).toBe('u2');
  });

  it('buildChatListItems keeps thinking, text, then tools block order', () => {
    const messages = [
      msg(
        'a1',
        'assistant',
        [
          { type: 'thinking', text: 'hmm' },
          { type: 'text', text: 'reply' },
          { type: 'tool_use', id: 'tu1', name: 'read', input: { path: '/a' } },
        ],
        1,
      ),
      msg(
        'u1',
        'user',
        [{ type: 'tool_result', toolUseId: 'tu1', content: 'ok' }],
        2,
      ),
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
        input: { path: '/续写/a.md' },
        status: 'success',
      }),
    ).toBe('/续写/a.md');
    expect(
      vfsToolFilePath({
        toolUseId: 't2',
        name: 'fs',
        input: { action: 'ls', path: '/' },
        status: 'success',
      }),
    ).toBeUndefined();
  });

  it('vfsToolFilePath normalizes relative paths', () => {
    expect(
      vfsToolFilePath({
        toolUseId: 't3',
        name: 'write',
        input: { path: 'chapter.md' },
        status: 'success',
      }),
    ).toBe('/chapter.md');
    expect(
      vfsToolFilePath({
        toolUseId: 't4',
        name: 'read',
        input: { path: 'notes/a.md' },
        status: 'success',
      }),
    ).toBe('/notes/a.md');
  });

  it('Bug1: vfsToolFilePath 兼容 file_path 字段名（透传到 core 兑底）', () => {
    // 某些 LLM 会用 file_path 而非标准的 path，core resolveVfsToolFilePath 已加兼容。
    expect(
      vfsToolFilePath({
        toolUseId: 't5',
        name: 'write',
        input: { file_path: 'chapter.md' },
        status: 'success',
      }),
    ).toBe('/chapter.md');
    expect(
      vfsToolFilePath({
        toolUseId: 't6',
        name: 'edit',
        input: { file_path: '/续写/a.md' },
        status: 'success',
      }),
    ).toBe('/续写/a.md');
    // path 优先于 file_path
    expect(
      vfsToolFilePath({
        toolUseId: 't7',
        name: 'write',
        input: { path: 'a.md', file_path: 'b.md' },
        status: 'success',
      }),
    ).toBe('/a.md');
  });

  it('T-SK8: skill_opt tool_result meta.skillRef 透传进 ToolCallView，skillToolRef 优先取 meta', () => {
    const messages = [
      msg('a1', 'assistant', [
        {
          type: 'tool_use',
          id: 'tu-skill',
          name: 'skill_opt',
          input: { action: 'read', name: 'demo' },
        } as never,
      ], 1),
      msg(
        'u1',
        'user',
        [
          {
            type: 'tool_result',
            toolUseId: 'tu-skill',
            content: 'ok',
            ok: true,
            meta: { skillRef: { domain: 'global', name: 'demo' } },
          } as never,
        ],
        2,
        true,
      ),
    ];
    const results = buildToolResultByUseId(messages);
    const use = messages[0]!.content.blocks[0] as never as {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    };
    const view = toolCallViewFromUse(use, results);
    expect(view.skillRef).toEqual({ domain: 'global', name: 'demo' });
    // meta 透传优先；输入侧（read 缺省域）解析不出也不影响
    expect(skillToolRef(view)).toEqual({ domain: 'global', name: 'demo' });
  });

  it('T-SK8: skillToolRef 输入侧解析 write 缺省 project 域并携带 projectId', () => {
    expect(
      skillToolRef(
        {
          toolUseId: 't-w',
          name: 'skill_opt',
          input: { action: 'write', name: 'demo', content: 'x' },
          status: 'pending',
        },
        'proj-1',
      ),
    ).toEqual({ domain: 'project', projectId: 'proj-1', name: 'demo' });
    // read 缺省域 pending：解析不出（等 tool_result meta）
    expect(
      skillToolRef({
        toolUseId: 't-r',
        name: 'skill_opt',
        input: { action: 'read', name: 'demo' },
        status: 'pending',
      }),
    ).toBeUndefined();
  });

  it('T-UO2x: 历史 UA 两段按普通 message，无 user_vfs_turn', () => {
    const actionXml = '<action name="delete">\n{"path":"/a.md"}\n</action>';
    const messages = [
      msg(
        'u1',
        'user',
        [{ type: 'text', text: wrapUserVfsActionsForStorage(actionXml) }],
        1,
        false,
        {
          metadata: {
            kind: 'user_vfs_action',
            source: 'user',
            synthetic: true,
          },
        },
      ),
      msg(
        'a1',
        'assistant',
        [{ type: 'text', text: USER_VFS_TURN_ACK_TEXT }],
        2,
        false,
        { metadata: { kind: 'user_vfs_ack', synthetic: true } },
      ),
    ];
    const items = buildChatListItems(messages);
    expect(items).toHaveLength(2);
    expect(items.every(i => i.kind === 'message')).toBe(true);
    expect(items[0]?.kind === 'message' && items[0].message.id).toBe('u1');
    expect(items[1]?.kind === 'message' && items[1].message.id).toBe('a1');
  });

  it('T-UO2x: hidden 历史 UA 两段仍为普通 message', () => {
    const actionXml = '<action name="delete">\n{"path":"/a.md"}\n</action>';
    const messages = [
      msg(
        'u1',
        'user',
        [{ type: 'text', text: wrapUserVfsActionsForStorage(actionXml) }],
        1,
        true,
        {
          metadata: {
            kind: 'user_vfs_action',
            source: 'user',
            synthetic: true,
          },
        },
      ),
      msg(
        'a1',
        'assistant',
        [{ type: 'text', text: USER_VFS_TURN_ACK_TEXT }],
        2,
        true,
        { metadata: { kind: 'user_vfs_ack', synthetic: true } },
      ),
    ];
    const items = buildChatListItems(messages);
    expect(items).toHaveLength(2);
    expect(items.every(i => i.kind === 'message')).toBe(true);
    expect(items[0]?.kind === 'message' && items[0].message.hidden).toBe(true);
  });

  it('B2-5: 旧四段 fixture 不产出 user_vfs_turn', () => {
    const messages = [
      msg(
        'u1',
        'user',
        [
          {
            type: 'text',
            text: '<action name="delete">\n{"path":"/a.md"}\n</action>',
          },
        ],
        1,
        false,
        {
          metadata: {
            kind: 'user_vfs_action',
            source: 'user',
            synthetic: true,
          },
        },
      ),
      msg(
        'a1',
        'assistant',
        [{ type: 'tool_use', id: 'tu1', name: 'fs', input: { action: 'ls' } }],
        2,
        false,
        {
          metadata: {
            synthetic: true,
            actor: 'user',
            toolInputCompressed: true,
          },
        },
      ),
      msg(
        'u2',
        'user',
        [{ type: 'tool_result', toolUseId: 'tu1', content: 'ok', ok: true }],
        3,
        false,
        { metadata: { source: 'user', synthetic: true } },
      ),
      msg('a2', 'assistant', [{ type: 'text', text: '【done】' }], 4, false, {
        metadata: { kind: 'tool_turn_bridge', synthetic: true },
      }),
    ];
    const items = buildChatListItems(messages);
    expect(items.every(i => i.kind === 'message')).toBe(true);
    expect(items.length).toBeGreaterThan(1);
  });
});
