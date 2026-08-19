/**
 * 聊天记录查询 IPC handler 测试（T-DI1 ~ T-DI7）。
 *
 * 直接调 handleMessagesSearch（不走 IPC bridge），用真实 sqlite 验证
 * handler 对 core searchMessages 的透传、字段完整性、翻页与错误转换。
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { getDesktopRuntime } from '../src/main/runtime/desktop-runtime-singleton.js';
import {
  handleMessagesAppend,
  handleMessagesSearch,
} from '../src/main/ipc/handlers/messages.js';
import { handleProjectsCreate } from '../src/main/ipc/handlers/projects.js';
import { handleAgentRegistryCreateBlank } from '../src/main/ipc/handlers/agent-registry.js';
import { handleAgentSetCurrent } from '../src/main/ipc/handlers/agent.js';
import { handleSessionsCreate } from '../src/main/ipc/handlers/sessions.js';
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from './desktop-db-test-env.js';

describe('handleMessagesSearch', () => {
  let tempDir: string;
  let projectId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv('nm-desktop-messages-search-'));

    const project = await handleProjectsCreate({ name: 'messages-search-ipc' });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;

    // 新 core 下 session 创建要求 workspace 已配置 agent。
    const blank = await handleAgentRegistryCreateBlank();
    assert.equal(blank.ok, true);
    if (blank.ok) {
      await handleAgentSetCurrent({ agentId: blank.data.agentId });
    }
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  async function createSession(title: string): Promise<string> {
    const session = await handleSessionsCreate({ projectId, title });
    assert.equal(session.ok, true);
    if (!session.ok) {
      throw new Error('failed to create session');
    }
    return session.data.id;
  }

  async function appendMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    text: string,
  ): Promise<string> {
    const result = await handleMessagesAppend({ sessionId, role, text });
    assert.equal(result.ok, true);
    if (!result.ok) {
      throw new Error('failed to append message');
    }
    return result.data.id;
  }

  it('T-DI1: 返回 IpcResult<ChatMessageDto[]>，字段齐全（hidden/seq/createdAtMs/bodyText）', async () => {
    const sessionId = await createSession('di1');
    await appendMessage(sessionId, 'user', 'hello world');
    await appendMessage(sessionId, 'assistant', 'hello reply');

    const result = await handleMessagesSearch({
      sessionId,
      keyword: 'hello',
      limit: 50,
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.data.length, 2);
    if (result.ok) {
      for (const dto of result.data) {
        assert.equal(typeof dto.seq, 'number');
        assert.equal(typeof dto.createdAtMs, 'number');
        assert.equal(typeof dto.hidden, 'boolean');
        assert.equal(typeof dto.bodyText, 'string');
        assert.ok(dto.bodyText.length > 0);
      }
    }
  });

  it('T-DI2: 精准匹配命中（大小写不敏感，透传 core）', async () => {
    const sessionId = await createSession('di2');
    await appendMessage(sessionId, 'user', 'Apple Banana');
    await appendMessage(sessionId, 'assistant', 'apple cherry');

    // 固定大小写不敏感：大小写不同的 apple 都应命中。
    const result = await handleMessagesSearch({
      sessionId,
      keyword: 'apple',
      limit: 50,
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.data.length, 2);
  });

  it('T-DI3: 匹配范围只限 user/assistant 的 TextBlock（透传 core）', async () => {
    const sessionId = await createSession('di3');
    await appendMessage(sessionId, 'user', 'target keyword here');
    await appendMessage(sessionId, 'assistant', 'totally unrelated text');

    const result = await handleMessagesSearch({
      sessionId,
      keyword: 'target',
      limit: 50,
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.data.length, 1);
    if (result.ok) {
      assert.match(result.data[0].bodyText, /target keyword here/);
    }
  });

  it('T-DI4: beforeSeq 翻页透传正确', async () => {
    const sessionId = await createSession('di4');
    await appendMessage(sessionId, 'user', 'page keyword one');
    await appendMessage(sessionId, 'user', 'page keyword two');
    await appendMessage(sessionId, 'user', 'page keyword three');

    // 先取最新一条，拿到他的 seq 作为翻页锚点。
    const first = await handleMessagesSearch({
      sessionId,
      keyword: 'keyword',
      limit: 1,
    });
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.data.length, 1);
    if (!first.ok) {
      return;
    }
    const anchorSeq = first.data[0].seq;

    // 用 beforeSeq = anchorSeq 翻页，应跳过最新一条返回更早的。
    const next = await handleMessagesSearch({
      sessionId,
      keyword: 'keyword',
      limit: 50,
      beforeSeq: anchorSeq,
    });
    assert.equal(next.ok, true);
    if (next.ok) {
      assert.equal(next.data.length, 2);
      for (const dto of next.data) {
        assert.ok(dto.seq < anchorSeq, `seq=${dto.seq} 应小于锚点 ${anchorSeq}`);
      }
    }
  });

  it('T-DI5: 不套 regex-apply，结果 bodyText 是原始文本（断言不被正则改写）', async () => {
    const sessionId = await createSession('di5');
    // 原始文本带方括号标记：regex-apply 若介入可能改写，handler 应原样返回。
    const raw = '原始文本 [placeholder] 不应被改写';
    await appendMessage(sessionId, 'user', raw);

    const result = await handleMessagesSearch({
      sessionId,
      keyword: '原始文本',
      limit: 50,
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.data.length, 1);
    if (result.ok) {
      assert.equal(result.data[0].bodyText, raw);
    }
  });

  it('T-DI6: 错误转 IpcResult.error（formatIpcError）', async () => {
    const sessionId = await createSession('di6');
    await appendMessage(sessionId, 'user', 'something');

    // 临时让 runtime 的 searchMessages 抛异常，验证 handler 的 try/catch 把异常
    // 经 formatIpcError 转成 { ok: false, error }。调用后立即恢复原方法。
    const rt = await getDesktopRuntime();
    const original = rt.messages.searchMessages.bind(rt.messages);
    (rt.messages as unknown as { searchMessages: unknown }).searchMessages =
      function () {
        throw new Error('search boom');
      };

    try {
      const result = await handleMessagesSearch({
        sessionId,
        keyword: 'something',
        limit: 50,
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.error.code);
        assert.ok(result.error.message.length > 0);
      }
    } finally {
      (rt.messages as unknown as { searchMessages: unknown }).searchMessages =
        original;
    }
  });

  it('T-DI7: 请求带 fromSeq/toSeq 时透传到 core 并影响结果', async () => {
    const sessionId = await createSession('di7');
    for (let i = 1; i <= 6; i++) {
      await appendMessage(sessionId, 'user', `range message ${i}`);
    }

    // 闭区间 2-4：应只返回 seq 2/3/4，按 seq 倒序。
    const result = await handleMessagesSearch({
      sessionId,
      keyword: '',
      limit: 50,
      fromSeq: 2,
      toSeq: 4,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(
        result.data.map((dto) => dto.seq),
        [4, 3, 2],
      );
    }

    // 仅 fromSeq=5：返回 seq >= 5。
    const fromOnly = await handleMessagesSearch({
      sessionId,
      keyword: '',
      limit: 50,
      fromSeq: 5,
    });
    assert.equal(fromOnly.ok, true);
    if (fromOnly.ok) {
      assert.deepEqual(
        fromOnly.data.map((dto) => dto.seq),
        [6, 5],
      );
    }
  });
});
