/**
 * read-tool-result-ref Step 6 mobile 面回见：引用态（contentRef 且 content
 * 为空串）工具卡的摘要链 `error.summary → summarizeToolInput(tool_use.input)
 * → resultContent 截断兜底`——read 必命中 `input.path`，空 content 最坏渲染
 * 空摘要、不炸。断言按 summarizeToolInput 链（勿按 result.summary 断言——
 * spec 明示会踩空）。
 */
import type {ChatMessage} from '@novel-master/core/chat';
import {
  buildChatListItems,
  toolCallSummary,
} from '@/components/chat/message-blocks';

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
    content: {blocks},
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

const READ_REF = {
  path: '/novel/ch1.md',
  entryId: 920001,
  version: 3,
  contentHash: 'a'.repeat(64),
  totalBytes: 4096,
  offset: 1,
  returnedLines: 120,
  totalLines: 120,
  truncated: false,
};

describe('message-blocks read 引用态（read-tool-result-ref）', () => {
  it('read 引用态成功卡：摘要取 input.path（summarizeToolInput 链），空 content 不炸', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu-rr', name: 'read', input: {path: '/novel/ch1.md'}},
      ], 1),
      msg('u1', 'user', [
        {
          type: 'tool_result',
          toolUseId: 'tu-rr',
          content: '',
          ok: true,
          summary: '120 lines',
          contentRef: READ_REF,
        },
      ], 2),
    ];
    const items = buildChatListItems(messages);
    expect(items.length).toBe(1);
    if (items[0]?.kind !== 'message') {
      throw new Error('expected message item');
    }
    const tool = items[0].tools[0]!;
    expect(tool.status).toBe('success');
    // 按 summarizeToolInput 链断言：read 的 input.path 命中——与 result 的
    // summary/content 无关（引用态 content 恒空串）。
    expect(toolCallSummary(tool)).toBe('/novel/ch1.md');
  });

  it('read 引用态失败卡：error.summary 仍在链首（ok=false + summary）', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu-rr', name: 'read', input: {path: '/novel/ch1.md'}},
      ], 1),
      msg('u1', 'user', [
        {
          type: 'tool_result',
          toolUseId: 'tu-rr',
          content: '',
          ok: false,
          summary: '文件不存在',
          contentRef: READ_REF,
        },
      ], 2),
    ];
    const items = buildChatListItems(messages);
    if (items[0]?.kind !== 'message') {
      throw new Error('expected message item');
    }
    const tool = items[0].tools[0]!;
    expect(tool.status).toBe('error');
    expect(toolCallSummary(tool)).toBe('文件不存在');
  });

  it('无 path 输入的引用态（理论形态）：resultContent 空串兜底输出空摘要、不炸', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu-x', name: 'noop', input: {}},
      ], 1),
      msg('u1', 'user', [
        {
          type: 'tool_result',
          toolUseId: 'tu-x',
          content: '',
          ok: true,
          contentRef: {...READ_REF, path: '/lost.md'},
        },
      ], 2),
    ];
    const items = buildChatListItems(messages);
    if (items[0]?.kind !== 'message') {
      throw new Error('expected message item');
    }
    expect(toolCallSummary(items[0].tools[0]!)).toBe('');
  });

  it('legacy 全文块行为不变：read 摘要仍取 input.path', () => {
    const messages = [
      msg('a1', 'assistant', [
        {type: 'tool_use', id: 'tu-rr', name: 'read', input: {path: '/novel/ch1.md'}},
      ], 1),
      msg('u1', 'user', [
        {
          type: 'tool_result',
          toolUseId: 'tu-rr',
          content: '     1|旧存量全文\n     2|第二行',
          ok: true,
          summary: '2 lines',
        },
      ], 2),
    ];
    const items = buildChatListItems(messages);
    if (items[0]?.kind !== 'message') {
      throw new Error('expected message item');
    }
    expect(toolCallSummary(items[0].tools[0]!)).toBe('/novel/ch1.md');
  });
});
