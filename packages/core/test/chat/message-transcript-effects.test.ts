/**
 * MessageTranscriptEffectsService 单测。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { textBlocks } from '@novel-master/core/chat';
import { createMessageTranscriptEffectsService } from '../../src/service/chat/create-message-transcript-effects.js';
import { DefaultMessageTranscriptEffectsService } from '../../src/service/chat/impl/message-transcript-effects.service.js';
import { createSessionKkvService } from '../../src/service/session-kkv/create-session-kkv-service.js';
import type { SessionKkvService } from '../../src/service/session-kkv/session-kkv.port.js';
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  SESSION_KKV_DOMAIN_USER_VFS_PENDING,
  RULE_SNAPSHOT_CANON_KEY,
  USER_VFS_PENDING_QUEUE_KEY,
} from '../../src/domain/session-kkv/model/session-kkv-domains.js';
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from '../helpers/novel-master-fixture.js';

novelMasterTestFixture();

describe('MessageTranscriptEffectsService', () => {
  it('T-WEC1：hideMessagesInRange 更新 hidden', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const effects = createMessageTranscriptEffectsService(ctx.conn);

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

    const updated = await ctx.messages.get(assistant.id);
    assert.equal(updated.hidden, true);
  });

  it('T-WEC2：showMessagesInRange 更新 hidden', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const effects = createMessageTranscriptEffectsService(ctx.conn);

    await ctx.messages.append(session.id, 'user', textBlocks('u'));
    await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a' }],
    });
    await ctx.messages.hideRange(session.id, 1, 2);

    await effects.showMessagesInRange(project.id, session.id, 1, 2);

    const messages = await ctx.messages.listBySession(session.id);
    assert.ok(messages.every(m => !m.hidden));
  });

  it('truncateMessagesAfter 删除 tail，VFS 不变', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const effects = createMessageTranscriptEffectsService(ctx.conn);

    await svfs.write('/keep.md', 'stable', { versionCheck: false });
    const m1 = await ctx.messages.append(session.id, 'user', textBlocks('1'));
    const m2 = await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: '2' }],
    });
    await svfs.write('/tail.md', 'tail', { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, m2.id);
    await ctx.messages.append(session.id, 'user', textBlocks('3'));

    await effects.truncateMessagesAfter(project.id, session.id, m1.seq);

    const left = await ctx.messages.listBySession(session.id);
    assert.equal(left.length, 1);
    assert.equal(left[0]!.id, m1.id);
    assert.equal((await svfs.read('/keep.md')).content, 'stable');
    assert.equal((await svfs.read('/tail.md')).content, 'tail');
  });

  it('T-CR5/T-SF1：setMessageFloorAtMessage 仅清 rule_snapshot+file_cache，保留 pending', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const effects = createMessageTranscriptEffectsService(ctx.conn);
    const sk = createSessionKkvService(ctx.conn);
    await sk.set(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      'full:/a.md',
      JSON.stringify({ body: 'x', mtimeMs: 1 }),
    );
    await sk.set(
      session.id,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      RULE_SNAPSHOT_CANON_KEY,
      '[]',
    );
    await sk.set(
      session.id,
      SESSION_KKV_DOMAIN_USER_VFS_PENDING,
      USER_VFS_PENDING_QUEUE_KEY,
      JSON.stringify([{ op: 'mkdir', path: '/keep-dir' }]),
    );
    const anchor = await ctx.messages.append(session.id, 'user', textBlocks('u'));
    await effects.setMessageFloorAtMessage(project.id, session.id, anchor.id);
    assert.equal(
      await sk.get(session.id, SESSION_KKV_DOMAIN_FILE_CACHE, 'full:/a.md'),
      null,
    );
    assert.equal(
      await sk.get(
        session.id,
        SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
        RULE_SNAPSHOT_CANON_KEY,
      ),
      null,
    );
    assert.equal(
      await sk.get(
        session.id,
        SESSION_KKV_DOMAIN_USER_VFS_PENDING,
        USER_VFS_PENDING_QUEUE_KEY,
      ),
      JSON.stringify([{ op: 'mkdir', path: '/keep-dir' }]),
    );
  });

  it('T-SF4：setMessageFloorAtMessage 后 prefix hidden、suffix visible', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const effects = createMessageTranscriptEffectsService(ctx.conn);

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

  it('T-WEC3：setMessageFloorAtMessage Core 路径可置位', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const effects = createMessageTranscriptEffectsService(ctx.conn);

    const anchor = await ctx.messages.append(session.id, 'user', textBlocks('u'));
    await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a' }],
    });

    await effects.setMessageFloorAtMessage(project.id, session.id, anchor.id);
  });

  it('T-SF6：置位不 truncate，消息条数不变', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const effects = createMessageTranscriptEffectsService(ctx.conn);

    await svfs.write('/keep.md', 'stable', { versionCheck: false });
    await ctx.messages.append(session.id, 'user', textBlocks('1'));
    const m2 = await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: '2' }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, m2.id);
    const m3 = await ctx.messages.append(session.id, 'user', textBlocks('3'));

    const before = await ctx.messages.listBySession(session.id);
    await effects.setMessageFloorAtMessage(project.id, session.id, m3.id);
    const after = await ctx.messages.listBySession(session.id);

    assert.equal(after.length, before.length);
    assert.equal((await svfs.read('/keep.md')).content, 'stable');
  });

  it('T-SF4b：末条 hidden user 锚点置位后恢复可见', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const effects = createMessageTranscriptEffectsService(ctx.conn);

    await ctx.messages.append(session.id, 'user', textBlocks('u1'));
    await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a1' }],
    });
    const m3 = await ctx.messages.append(session.id, 'user', textBlocks('u2'));
    await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a2' }],
    });
    await ctx.messages.hideRange(session.id, 3, 3);

    const result = await effects.setMessageFloorAtMessage(
      project.id,
      session.id,
      m3.id,
    );
    assert.ok(result.shownCount >= 1);

    const updated = await ctx.messages.get(m3.id);
    assert.equal(updated.hidden, false);
  });

  // T-SC3（S-1 迁移）：setMessageFloorAtMessage 的 4 步塞进 CoordinatedWrite 后，
  // 中间步骤（clear-rule-snapshot）抛错时，前面已执行的 hide/show 必须被逆序回滚，
  // 恢复可见性计数一致（ref_count 一致）——不能留半隐藏状态。
  it('T-SC3：setMessageFloorAtMessage 中间失败 → hide/show 回滚、可见性一致', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const m1 = await ctx.messages.append(session.id, 'user', textBlocks('u1'));
    await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a1' }],
    });
    const m3 = await ctx.messages.append(session.id, 'user', textBlocks('u2'));
    await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a2' }],
    });
    // 先把后两条隐藏，模拟“旧 floor 在 m3 之前”的历史状态
    await ctx.messages.hideRange(session.id, 3, 4);

    const before = await ctx.messages.listBySession(session.id);
    const beforeVisibility = before.map(m => ({ id: m.id, hidden: m.hidden }));

    // 包一层 sessionKkv：clearDomain(RULE_SNAPSHOT) 抛错，模拟第 3 步失败
    const inner = createSessionKkvService(ctx.conn);
    const failingKkv: SessionKkvService = {
      get: (s, d, k) => inner.get(s, d, k),
      set: (s, d, k, v) => inner.set(s, d, k, v),
      delete: (s, d, k) => inner.delete(s, d, k),
      clearSession: s => inner.clearSession(s),
      listKeys: (s, d) => inner.listKeys(s, d),
      async clearDomain(s, domain) {
        if (domain === SESSION_KKV_DOMAIN_RULE_SNAPSHOT) {
          throw new Error('clear-rule-snapshot boom');
        }
        await inner.clearDomain(s, domain);
      },
    };
    const effects = new DefaultMessageTranscriptEffectsService({
      conn: ctx.conn,
      messages: ctx.messages,
      sessionKkv: failingKkv,
    });

    await assert.rejects(
      () => effects.setMessageFloorAtMessage(project.id, session.id, m3.id),
      /clear-rule-snapshot boom/,
    );

    // 可见性回滚：与调用前完全一致（hide-prefix 的 showRange 补偿 + show-suffix 的 hideRange 补偿）
    const after = await ctx.messages.listBySession(session.id);
    assert.deepEqual(
      after.map(m => ({ id: m.id, hidden: m.hidden })),
      beforeVisibility,
      '中间步骤失败后 hide/show 必须逆序回滚，可见性计数与调用前一致',
    );
  });

  it('T-SF7：role=system 抛错', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const effects = createMessageTranscriptEffectsService(ctx.conn);

    const system = await ctx.messages.append(
      session.id,
      'system',
      textBlocks('sys'),
    );

    await assert.rejects(
      () => effects.setMessageFloorAtMessage(project.id, session.id, system.id),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /set-floor anchor role must be user/);
        return true;
      },
    );
  });

  it('T-AC1-2：role=assistant 锚点抛错且 transcript 不变', async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const effects = createMessageTranscriptEffectsService(ctx.conn);

    await ctx.messages.append(session.id, 'user', textBlocks('u'));
    const assistant = await ctx.messages.append(session.id, 'assistant', {
      blocks: [{ type: 'text', text: 'a' }],
    });

    const before = await ctx.messages.listBySession(session.id);

    await assert.rejects(
      () =>
        effects.setMessageFloorAtMessage(
          project.id,
          session.id,
          assistant.id,
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /set-floor anchor role must be user/);
        return true;
      },
    );

    const after = await ctx.messages.listBySession(session.id);
    assert.deepEqual(
      after.map(m => ({ id: m.id, hidden: m.hidden })),
      before.map(m => ({ id: m.id, hidden: m.hidden })),
    );
  });
});
