import { type ChatMessage } from '@novel-master/core/chat';
import {
  buildMessageActionItems,
  isSetFloorEligibleMessage,
} from '../src/components/chat/message-edit';

function msg(
  blocks: ChatMessage['content']['blocks'],
  role: ChatMessage['role'] = 'user',
): ChatMessage {
  return {
    id: 'm1',
    sessionId: 's1',
    seq: 1,
    role,
    content: { blocks },
    provider: null,
    raw: null,
    createdAtMs: 1,
    hidden: false,
  };
}

describe('isSetFloorEligibleMessage', () => {
  it('allows user role only', () => {
    expect(isSetFloorEligibleMessage(msg([{ type: 'text', text: 'hi' }]))).toBe(
      true,
    );
    expect(
      isSetFloorEligibleMessage(
        msg([{ type: 'text', text: 'reply' }], 'assistant'),
      ),
    ).toBe(false);
  });

  it('rejects system role', () => {
    expect(
      isSetFloorEligibleMessage(msg([{ type: 'text', text: 'sys' }], 'system')),
    ).toBe(false);
  });
});

describe('buildMessageActionItems', () => {
  it('T-MN1: includes edit, copy, set-floor, fork, rollback for editable messages', () => {
    const actions = buildMessageActionItems(
      msg([{ type: 'text', text: 'hi' }]),
    ).map(i => i.action);
    expect(actions).toEqual(['edit', 'copy', 'set-floor', 'fork', 'rollback']);
  });

  it('excludes set-floor for assistant messages with text and tool_use', () => {
    const actions = buildMessageActionItems(
      msg(
        [
          { type: 'text', text: 'reply' },
          { type: 'tool_use', id: 't1', name: 'vfs.read', input: {} },
        ],
        'assistant',
      ),
    ).map(i => i.action);
    expect(actions).toEqual(['edit', 'copy', 'fork', 'rollback']);
  });

  it('excludes set-floor when assistant has only tool_use blocks', () => {
    const actions = buildMessageActionItems(
      msg(
        [{ type: 'tool_use', id: 't1', name: 'vfs.read', input: {} }],
        'assistant',
      ),
    ).map(i => i.action);
    expect(actions).toEqual(['copy', 'fork', 'rollback']);
  });

  it('hidden 消息含置位、无 rollback', () => {
    const actions = buildMessageActionItems({
      ...msg([{ type: 'text', text: 'hi' }]),
      hidden: true,
    }).map(i => i.action);
    expect(actions).toEqual(['edit', 'copy', 'set-floor', 'fork']);
  });

  it('set-floor 在 copy 之后、fork 之前', () => {
    const items = buildMessageActionItems(msg([{ type: 'text', text: 'hi' }]));
    const copyIdx = items.findIndex(i => i.action === 'copy');
    const setFloorIdx = items.findIndex(i => i.action === 'set-floor');
    const forkIdx = items.findIndex(i => i.action === 'fork');
    expect(copyIdx).toBeGreaterThanOrEqual(0);
    expect(setFloorIdx).toBe(copyIdx + 1);
    expect(forkIdx).toBe(setFloorIdx + 1);
  });
});

/** Mirrors useChatTabMessages set-floor toast selection. */
function resolveSetFloorToastMessage(result: {
  hiddenCount: number;
  shownCount: number;
}): string {
  const changed = result.hiddenCount + result.shownCount;
  return changed > 0 ? '已置位' : '上下文已是最新状态';
}

describe('set-floor toast (T-SF18 mobile)', () => {
  it('有变更时 Toast「已置位」', () => {
    expect(resolveSetFloorToastMessage({ hiddenCount: 1, shownCount: 0 })).toBe(
      '已置位',
    );
    expect(resolveSetFloorToastMessage({ hiddenCount: 0, shownCount: 2 })).toBe(
      '已置位',
    );
  });

  it('幂等无变更时 Toast「上下文已是最新状态」', () => {
    expect(resolveSetFloorToastMessage({ hiddenCount: 0, shownCount: 0 })).toBe(
      '上下文已是最新状态',
    );
  });
});
