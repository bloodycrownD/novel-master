import { type ChatMessage } from '@novel-master/core/chat';
import {
  deleteToolTurn,
  hideToolTurn,
} from '../src/components/chat/tool-turn-actions';

function msg(
  id: string,
  role: string,
  blocks: ChatMessage['content']['blocks'],
  seq: number,
): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq,
    role,
    content: { blocks },
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

function createRuntime() {
  const hidden = new Set<string>();
  const deleted = new Set<string>();
  return {
    runtime: {
      messages: {
        hide: jest.fn(async (id: string) => {
          hidden.add(id);
        }),
        show: jest.fn(async (id: string) => {
          hidden.delete(id);
        }),
        delete: jest.fn(async (id: string) => {
          deleted.add(id);
        }),
      },
    },
    hidden,
    deleted,
  };
}

describe('tool-turn-actions', () => {
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
    msg('u2', 'user', [{ type: 'text', text: 'plain' }], 3),
  ];

  it('hideToolTurn hides assistant and paired tool_results', async () => {
    const { runtime, hidden } = createRuntime();
    await hideToolTurn(runtime, messages, 'a1', true);
    expect(runtime.messages.hide).toHaveBeenCalledWith('a1');
    expect(runtime.messages.hide).toHaveBeenCalledWith('u1');
    expect(hidden).toEqual(new Set(['a1', 'u1']));
  });

  it('hideToolTurn shows assistant and paired tool_results', async () => {
    const { runtime } = createRuntime();
    await hideToolTurn(runtime, messages, 'a1', false);
    expect(runtime.messages.show).toHaveBeenCalledWith('a1');
    expect(runtime.messages.show).toHaveBeenCalledWith('u1');
  });

  it('hideToolTurn only hides single message without tool_use', async () => {
    const { runtime, hidden } = createRuntime();
    await hideToolTurn(runtime, messages, 'u2', true);
    expect(runtime.messages.hide).toHaveBeenCalledTimes(1);
    expect(runtime.messages.hide).toHaveBeenCalledWith('u2');
    expect(hidden).toEqual(new Set(['u2']));
  });

  it('deleteToolTurn deletes assistant and paired tool_results', async () => {
    const { runtime, deleted } = createRuntime();
    await deleteToolTurn(runtime, messages, 'a1');
    expect(runtime.messages.delete).toHaveBeenCalledWith('u1');
    expect(runtime.messages.delete).toHaveBeenCalledWith('a1');
    expect(deleted).toEqual(new Set(['u1', 'a1']));
  });

  it('deleteToolTurn only deletes plain messages', async () => {
    const { runtime, deleted } = createRuntime();
    await deleteToolTurn(runtime, messages, 'u2');
    expect(runtime.messages.delete).toHaveBeenCalledTimes(1);
    expect(runtime.messages.delete).toHaveBeenCalledWith('u2');
    expect(deleted).toEqual(new Set(['u2']));
  });
});
