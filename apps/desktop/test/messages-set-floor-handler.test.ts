/**
 * T-SF14：Desktop IPC handleMessagesSetFloor 委托 effects；markDirty 路径。
 * T-SF18：幂等置位返回零变更 counts，驱动 Toast「上下文已是最新状态」。
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { getDesktopRuntime } from '../src/main/runtime/desktop-runtime-singleton.js';
import {
  handleMessagesAppend,
  handleMessagesSetFloor,
} from '../src/main/ipc/handlers/messages.js';
import { handleProjectsCreate } from '../src/main/ipc/handlers/projects.js';
import { handleSessionsCreate } from '../src/main/ipc/handlers/sessions.js';
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from './desktop-db-test-env.js';

/** Mirrors ConversationPanel handleConfirm set-floor toast selection. */
function resolveSetFloorToastMessage(result: {
  hiddenCount: number;
  shownCount: number;
}): string {
  const changed = result.hiddenCount + result.shownCount;
  return changed > 0 ? '已置位' : '上下文已是最新状态';
}

describe('handleMessagesSetFloor', () => {
  let tempDir: string;
  let projectId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv('nm-desktop-set-floor-'));

    const project = await handleProjectsCreate({ name: 'set-floor-ipc' });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;
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

  it('T-SF14: 委托 messageTranscriptEffects 并 markDirty', async () => {
    const sessionId = await createSession('sf14');
    const rt = await getDesktopRuntime();
    await appendMessage(sessionId, 'user', 'u1');
    await appendMessage(sessionId, 'assistant', 'a1');
    const anchorId = await appendMessage(sessionId, 'user', 'u2');
    await appendMessage(sessionId, 'assistant', 'a2');
    await rt.messages.hideRange(sessionId, 3, 4);

    const result = await handleMessagesSetFloor({
      projectId,
      sessionId,
      messageId: anchorId,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.hiddenCount, 2);
      assert.equal(result.data.shownCount, 2);
    }
    assert.equal(rt.worktreeSnapshot.isDirty(projectId, sessionId), true);

    const anchor = await rt.messages.get(anchorId);
    const messages = await rt.messages.listBySession(sessionId);
    for (const m of messages) {
      if (m.seq < anchor.seq) {
        assert.equal(m.hidden, true, `seq=${m.seq} 应为 hidden`);
      } else {
        assert.equal(m.hidden, false, `seq=${m.seq} 应为 visible`);
      }
    }
  });

  it('T-SF18: 幂等置位返回零变更 counts，Toast「上下文已是最新状态」', async () => {
    const sessionId = await createSession('sf18');
    const rt = await getDesktopRuntime();
    await appendMessage(sessionId, 'user', 'u1');
    const anchorId = await appendMessage(sessionId, 'assistant', 'a1');
    await appendMessage(sessionId, 'user', 'u2');

    const first = await handleMessagesSetFloor({
      projectId,
      sessionId,
      messageId: anchorId,
    });
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.ok(first.data.hiddenCount + first.data.shownCount > 0);
    }

    const second = await handleMessagesSetFloor({
      projectId,
      sessionId,
      messageId: anchorId,
    });
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(second.data.hiddenCount, 0);
      assert.equal(second.data.shownCount, 0);
      assert.equal(
        resolveSetFloorToastMessage(second.data),
        '上下文已是最新状态',
      );
    }
  });
});
