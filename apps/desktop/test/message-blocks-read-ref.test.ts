/**
 * read-tool-result-ref Step 6 desktop 面：
 *
 * - UI 工具卡回归：摘要链 `error.summary → summarizeToolInput(tool_use.input)
 *   → resultContent 截断兜底`——read 必命中 `input.path`，引用态（含
 *   contentRef 且 content 为空串）最坏渲染空摘要、不炸。断言按
 *   summarizeToolInput 链（勿按 result.summary 断言——spec 明示会踩空）。
 * - bodyText 引用态占位：messages IPC handler 的 bodyText 组装对引用块输出
 *   `[read ref: path]` 占位标记；skill 引用块走窄化文案
 *   `[skill ref: domain/name]`（不得误标成 read ref）；legacy 块（无
 *   contentRef）逐字节不变。
 */
import assert from 'node:assert/strict';
import { after, before, describe, it, test } from 'node:test';
import type { ChatMessageDto } from '@shared/ipc-types';
import {
  buildChatListItems,
  toolCallSummary,
} from '@/features/chat/message-blocks';
import { handleMessagesList } from '../src/main/ipc/handlers/messages.js';
import { handleProjectsCreate } from '../src/main/ipc/handlers/projects.js';
import { handleAgentRegistryCreateBlank } from '../src/main/ipc/handlers/agent-registry.js';
import { handleAgentSetCurrent } from '../src/main/ipc/handlers/agent.js';
import { handleSessionsCreate } from '../src/main/ipc/handlers/sessions.js';
import { getDesktopRuntime } from '../src/main/runtime/desktop-runtime-singleton.js';
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from './desktop-db-test-env.js';

function assistantToolUse(id: string, seq: number): ChatMessageDto {
  return {
    id,
    sessionId: 's1',
    seq,
    role: 'assistant',
    hidden: false,
    createdAtMs: seq,
    bodyText: '',
    contentBlocks: [
      { type: 'tool_use', id: 'tu-rr', name: 'read', input: { path: '/novel/ch1.md' } },
    ],
  };
}

function refResultMessage(seq: number, overrides?: {
  ok?: boolean;
  summary?: string;
}): ChatMessageDto {
  return {
    id: 'u-ref',
    sessionId: 's1',
    seq,
    role: 'user',
    hidden: false,
    createdAtMs: seq,
    bodyText: '',
    contentBlocks: [
      {
        type: 'tool_result',
        toolUseId: 'tu-rr',
        content: '',
        ok: overrides?.ok ?? true,
        ...(overrides?.summary != null ? { summary: overrides.summary } : {}),
        contentRef: {
          path: '/novel/ch1.md',
          entryId: 920001,
          version: 3,
          contentHash: 'a'.repeat(64),
          totalBytes: 4096,
          offset: 1,
          returnedLines: 120,
          totalLines: 120,
          truncated: false,
        },
      },
    ],
  };
}

describe('read 引用态 UI 工具卡回归（summarizeToolInput 链）', () => {
  it('read 引用态成功卡：摘要取 input.path（summarizeToolInput 链），引用空 content 不炸', () => {
    const assistant = assistantToolUse('a1', 1);
    const items = buildChatListItems([assistant, refResultMessage(2)], {});
    assert.equal(items.length, 1);
    if (items[0]?.kind !== 'message') {
      assert.fail('expected message item');
    }
    const tool = items[0].tools[0]!;
    assert.equal(tool.status, 'success');
    // 断言按 summarizeToolInput 链：read 的 input.path 直接命中——
    // 即便 result.content 为空串、result.summary 另有其值也不受影响。
    assert.equal(toolCallSummary(tool), '/novel/ch1.md');
  });

  it('read 引用态失败卡：error.summary 仍在链首（ok=false + summary）', () => {
    const assistant = assistantToolUse('a2', 1);
    const items = buildChatListItems(
      [assistant, refResultMessage(2, { ok: false, summary: '文件不存在' })],
      {},
    );
    if (items[0]?.kind !== 'message') {
      assert.fail('expected message item');
    }
    const tool = items[0].tools[0]!;
    assert.equal(tool.status, 'error');
    assert.equal(toolCallSummary(tool), '文件不存在');
  });

  it('无 path 输入的引用态（理论形态）：resultContent 空串兜底输出空摘要、不炸', () => {
    const assistant: ChatMessageDto = {
      id: 'a3',
      sessionId: 's1',
      seq: 1,
      role: 'assistant',
      hidden: false,
      createdAtMs: 1,
      bodyText: '',
      contentBlocks: [
        { type: 'tool_use', id: 'tu-x', name: 'noop', input: {} },
      ],
    };
    const refNoPath: ChatMessageDto = {
      ...refResultMessage(2),
      contentBlocks: [
        {
          type: 'tool_result',
          toolUseId: 'tu-x',
          content: '',
          ok: true,
          contentRef: {
            path: '/lost.md',
            entryId: 1,
            version: 1,
            contentHash: 'b'.repeat(64),
            totalBytes: 1,
            offset: 1,
            returnedLines: 1,
            totalLines: 1,
            truncated: false,
          },
        },
      ],
    };
    const items = buildChatListItems([assistant, refNoPath], {});
    if (items[0]?.kind !== 'message') {
      assert.fail('expected message item');
    }
    // summarizeToolInput 无 path / resultContent 空串 → 空摘要（渲染为空，
    // 不抛错）。
    assert.equal(toolCallSummary(items[0].tools[0]!), '');
  });

  it('legacy 全文块行为不变：read 摘要仍取 input.path', () => {
    const assistant = assistantToolUse('a4', 1);
    const legacy: ChatMessageDto = {
      id: 'u-legacy',
      sessionId: 's1',
      seq: 2,
      role: 'user',
      hidden: false,
      createdAtMs: 2,
      bodyText: '',
      contentBlocks: [
        {
          type: 'tool_result',
          toolUseId: 'tu-rr',
          content: '     1|旧存量全文\n     2|第二行',
          ok: true,
          summary: '2 lines',
        },
      ],
    };
    const items = buildChatListItems([assistant, legacy], {});
    if (items[0]?.kind !== 'message') {
      assert.fail('expected message item');
    }
    assert.equal(toolCallSummary(items[0].tools[0]!), '/novel/ch1.md');
  });
});

describe('read 引用态 bodyText 占位（messages IPC handler）', () => {
  let tempDir: string;
  let sessionId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv('nm-desktop-read-ref-'));
    const project = await handleProjectsCreate({ name: 'read-ref-body-text' });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    const blank = await handleAgentRegistryCreateBlank();
    assert.equal(blank.ok, true);
    if (blank.ok) {
      await handleAgentSetCurrent({ agentId: blank.data.agentId });
    }
    const session = await handleSessionsCreate({
      projectId: project.data.id,
      title: 'read-ref-body-text',
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;
    // 直接落一条引用态 tool_result 消息（生产形态：content 空串 + contentRef）
    // 与一条 legacy 全文消息作对照。
    const rt = await getDesktopRuntime();
    const now = Date.now();
    await rt.conn.execute(
      `INSERT INTO chat_message (id, session_id, seq, role, content_json, provider, raw_json, created_at_ms, hidden)
       VALUES
       ('msg-ref', ?, 1, 'user', ?, NULL, NULL, ?, 0),
       ('msg-legacy', ?, 2, 'user', ?, NULL, NULL, ?, 0),
       ('msg-skill-ref', ?, 3, 'user', ?, NULL, NULL, ?, 0)`,
      [
        sessionId,
        JSON.stringify({
          blocks: [
            {
              type: 'tool_result',
              toolUseId: 'tu-body',
              content: '',
              ok: true,
              summary: '3 lines',
              contentRef: {
                path: '/ref.md',
                entryId: 920001,
                version: 1,
                contentHash: 'c'.repeat(64),
                totalBytes: 41,
                offset: 1,
                returnedLines: 3,
                totalLines: 3,
                truncated: false,
              },
            },
          ],
        }),
        now,
        sessionId,
        JSON.stringify({
          blocks: [
            {
              type: 'tool_result',
              toolUseId: 'tu-body2',
              content: '     1|legacy 全文',
              ok: true,
              summary: '1 lines',
            },
          ],
        }),
        now + 1,
        sessionId,
        JSON.stringify({
          blocks: [
            {
              type: 'tool_result',
              toolUseId: 'tu-skill-body',
              content: '',
              ok: true,
              summary: 'project:x-skill',
              contentRef: {
                kind: 'skill',
                action: 'load',
                domain: 'project',
                name: 'x-skill',
                path: 'SKILL.md',
                entryId: 930001,
                version: 1,
                contentHash: 'd'.repeat(64),
                totalBytes: 64,
                offset: 1,
                returnedLines: 0,
                totalLines: 0,
                truncated: false,
                files: ['refs/helper.md'],
              },
            },
          ],
        }),
        now + 2,
      ],
    );
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  test('引用态 bodyText 输出 [read ref: path] 占位；legacy 块逐字节不变', async () => {
    const result = await handleMessagesList({ sessionId });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    const byId = new Map(result.data.map((m) => [m.id, m]));
    const refMsg = byId.get('msg-ref');
    const legacyMsg = byId.get('msg-legacy');
    assert.ok(refMsg != null && legacyMsg != null);

    // 引用块：投影文本只剩 [tool_result id=…] 头时补占位标记
    assert.match(refMsg.bodyText, /\[tool_result id=tu-body\]/);
    assert.match(refMsg.bodyText, /\[read ref: \/ref\.md\]/);

    // legacy：无占位标记，正文原样
    assert.ok(!legacyMsg.bodyText.includes('[read ref:'));
    assert.ok(legacyMsg.bodyText.includes('     1|legacy 全文'));
  });

  test('skill 引用块 bodyText 输出 [skill ref: domain/name]，不得误标 [read ref: …]', async () => {
    const result = await handleMessagesList({ sessionId });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    const skillMsg = result.data.find((m) => m.id === 'msg-skill-ref');
    assert.ok(skillMsg != null);

    // skill ref 的 path 是技能目录内相对路径（此处 SKILL.md），脱离
    // domain/name 单独投影既无信息量又会误导——必须走窄化后的 skill 文案。
    assert.match(skillMsg.bodyText, /\[tool_result id=tu-skill-body\]/);
    assert.ok(
      skillMsg.bodyText.includes('[skill ref: project/x-skill]'),
      `skill 引用块 bodyText 应含 [skill ref: project/x-skill]，实际：${skillMsg.bodyText}`,
    );
    assert.ok(
      !skillMsg.bodyText.includes('[read ref:'),
      'skill 引用块不得被误标成 read ref',
    );
  });
});
