import type {ChatMessage} from '@novel-master/core';

jest.mock('@novel-master/core', () => {
  const actual = jest.requireActual('@novel-master/core');
  return {
    ...actual,
    resolveActiveCompiledRules: jest.fn(async () => []),
  };
});

import {loadSessionMessagesForDisplay} from '../src/services/regex-apply-channel';
import type {MobileNovelMasterRuntime} from '../src/runtime/types';

function msg(id: string, hidden: boolean): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq: 1,
    role: 'user',
    content: {blocks: [{type: 'text', text: 'hello'}]},
    provider: null,
    raw: null,
    createdAtMs: 1,
    hidden,
  };
}

describe('loadSessionMessagesForDisplay', () => {
  it('keeps hidden messages for chat list', async () => {
    const hidden = msg('h1', true);
    const visible = msg('v1', false);
    const runtime = {
      messages: {
        listBySession: async () => [visible, hidden],
      },
      state: {
        getCurrentRegexGroupId: async () => undefined,
      },
      regexConfig: {},
    } as unknown as MobileNovelMasterRuntime;

    const list = await loadSessionMessagesForDisplay(runtime, 's1');
    expect(list.map(m => m.id)).toEqual(['v1', 'h1']);
  });
});
