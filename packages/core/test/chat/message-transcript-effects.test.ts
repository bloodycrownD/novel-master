/**
 * MessageTranscriptEffectsService 单测。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { textBlocks } from '@novel-master/core/chat';
import { createSessionWorktreeSnapshotStore } from '@novel-master/core/worktree';
import { createMessageTranscriptEffectsService } from '../../src/service/chat/create-message-transcript-effects.js';
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from '../helpers/novel-master-fixture.js';

novelMasterTestFixture();

describe('MessageTranscriptEffectsService', () => {
  it('hideMessagesInRange 更新 hidden 并 markDirty', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const store = createSessionWorktreeSnapshotStore();
    const effects = createMessageTranscriptEffectsService(ctx.conn, store);

    await ctx.messages.append(session.id, 'user', textBlocks('u'));
    const assistant = await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a' }],
    });

    const count = await effects.hideMessagesInRange(
      project.id,
      session.id,
      1,
      2,
    );
    assert.equal(count, 2);
    assert.equal(store.isDirty(project.id, session.id), true);

    const updated = await ctx.messages.get(assistant.id);
    assert.equal(updated.hidden, true);
  });

  it('showMessagesInRange 更新 hidden 并 markDirty', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const store = createSessionWorktreeSnapshotStore();
    const effects = createMessageTranscriptEffectsService(ctx.conn, store);

    await ctx.messages.append(session.id, 'user', textBlocks('u'));
    await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a' }],
    });
    await ctx.messages.hideRange(session.id, 1, 2);

    await effects.showMessagesInRange(project.id, session.id, 1, 2);
    assert.equal(store.isDirty(project.id, session.id), true);

    const messages = await ctx.messages.listBySession(session.id);
    assert.ok(messages.every(m => !m.hidden));
  });

  it('truncateMessagesAfter 删除 tail 且不 markDirty，VFS 不变', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const store = createSessionWorktreeSnapshotStore();
    const effects = createMessageTranscriptEffectsService(ctx.conn, store);

    await svfs.write('/keep.md', 'stable', { versionCheck: false });
    const m1 = await ctx.messages.append(session.id, 'user', textBlocks('1'));
    const m2 = await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: '2' }],
    });
    await svfs.write('/tail.md', 'tail', { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, m2.id);
    await ctx.messages.append(session.id, 'user', textBlocks('3'));

    await effects.truncateMessagesAfter(project.id, session.id, m1.seq);

    assert.equal(store.isDirty(project.id, session.id), false);
    const left = await ctx.messages.listBySession(session.id);
    assert.equal(left.length, 1);
    assert.equal(left[0]!.id, m1.id);
    assert.equal((await svfs.read('/keep.md')).content, 'stable');
    assert.equal((await svfs.read('/tail.md')).content, 'tail');
  });

  it('T-SF4：setMessageFloorAtMessage 后 prefix hidden、suffix visible', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const store = createSessionWorktreeSnapshotStore();
    const effects = createMessageTranscriptEffectsService(ctx.conn, store);

    const m1 = await ctx.messages.append(session.id, 'user', textBlocks('u1'));
    await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a1' }],
    });
    const m3 = await ctx.messages.append(session.id, 'user', textBlocks('u2'));
    await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a2' }],
    });
    await ctx.messages.hideRange(session.id, 3, 4);

    const result = await effects.setMessageFloorAtMessage(
      project.id,
      session.id,
      m3.id,
    );
    assert.equal(result.hiddenCount, 2);
    assert.equal(result.shownCount, 2);

    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 4);
    for (const m of messages) {
      if (m.seq < m3.seq) {
        assert.equal(m.hidden, true, `seq=${m.seq} 应为 hidden`);
      } else {
        assert.equal(m.hidden, false, `seq=${m.seq} 应为 visible`);
      }
    }
  });

  it('T-SF5：置位后 worktreeSnapshot.isDirty === true', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const store = createSessionWorktreeSnapshotStore();
    const effects = createMessageTranscriptEffectsService(ctx.conn, store);

    await ctx.messages.append(session.id, 'user', textBlocks('u'));
    const anchor = await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a' }],
    });

    await effects.setMessageFloorAtMessage(project.id, session.id, anchor.id);
    assert.equal(store.isDirty(project.id, session.id), true);
  });

  it('T-SF6：置位不 truncate，消息条数不变', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const store = createSessionWorktreeSnapshotStore();
    const effects = createMessageTranscriptEffectsService(ctx.conn, store);

    await svfs.write('/keep.md', 'stable', { versionCheck: false });
    await ctx.messages.append(session.id, 'user', textBlocks('1'));
    const m2 = await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: '2' }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, m2.id);
    await ctx.messages.append(session.id, 'user', textBlocks('3'));

    const before = await ctx.messages.listBySession(session.id);
    await effects.setMessageFloorAtMessage(project.id, session.id, m2.id);
    const after = await ctx.messages.listBySession(session.id);

    assert.equal(after.length, before.length);
    assert.equal((await svfs.read('/keep.md')).content, 'stable');
  });

  it('T-SF4b：末条 hidden 锚点置位后恢复可见', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const store = createSessionWorktreeSnapshotStore();
    const effects = createMessageTranscriptEffectsService(ctx.conn, store);

    await ctx.messages.append(session.id, 'user', textBlocks('u1'));
    await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a1' }],
    });
    await ctx.messages.append(session.id, 'user', textBlocks('u2'));
    const m4 = await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a2' }],
    });
    await ctx.messages.hideRange(session.id, 4, 4);

    const result = await effects.setMessageFloorAtMessage(
      project.id,
      session.id,
      m4.id,
    );
    assert.ok(result.shownCount >= 1);

    const updated = await ctx.messages.get(m4.id);
    assert.equal(updated.hidden, false);
  });

  it('T-SF7：role=system 抛错', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const store = createSessionWorktreeSnapshotStore();
    const effects = createMessageTranscriptEffectsService(ctx.conn, store);

    const system = await ctx.messages.append(
      session.id,
      'system',
      textBlocks('sys'),
    );

    await assert.rejects(
      () => effects.setMessageFloorAtMessage(project.id, session.id, system.id),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /user or assistant/);
        return true;
      },
    );
  });
});
