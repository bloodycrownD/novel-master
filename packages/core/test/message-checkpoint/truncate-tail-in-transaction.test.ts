/**
 * truncate-tail-in-transaction 单测�?
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageCheckpointRepository } from "../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteSessionRepository } from "../../src/domain/chat/repositories/impl/sqlite-session.repository.js";
import {
  createTruncateTailDepsFromTx,
  truncateTailInTransaction,
} from "../../src/service/message-checkpoint/truncate-tail-wiring.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("truncateTailInTransaction", () => {
  it("截断 seq > afterSeq 的消息并清理 checkpoint", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    const m2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "2" }],
    });
    await svfs.write("/a.md", "v1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, m2.id);
    await ctx.messages.append(session.id, "user", textBlocks("3"));

    await ctx.conn.transaction(async (tx) => {
      await truncateTailInTransaction(createTruncateTailDepsFromTx(tx), {
        projectId: project.id,
        sessionId: session.id,
        afterSeq: m1.seq,
        sweepRevisions: false,
      });
    });

    const left = await ctx.messages.listBySession(session.id);
    assert.equal(left.length, 1);
    assert.equal(left[0]!.id, m1.id);

    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);
    const cp = await checkpoints.loadFileTree(session.id, m2.id);
    assert.equal(cp, null);
    assert.equal((await svfs.read("/a.md")).content, "v1");
  });

  it("tail 非空时清�?user_vfs_pending_json", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sessions = new SqliteSessionRepository(ctx.conn);
    await sessions.setUserVfsPendingJson(session.id, '{"entries":[]}');

    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    await ctx.messages.append(session.id, "user", textBlocks("2"));

    await ctx.conn.transaction(async (tx) => {
      await truncateTailInTransaction(createTruncateTailDepsFromTx(tx), {
        projectId: project.id,
        sessionId: session.id,
        afterSeq: m1.seq,
        sweepRevisions: false,
      });
    });

    const updated = await ctx.sessions.get(session.id);
    assert.equal(updated.userVfsPendingJson, null);
  });

  it("afterSeq 之后无消息时不改 pending", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sessions = new SqliteSessionRepository(ctx.conn);
    const pendingJson = '{"entries":[]}';
    await sessions.setUserVfsPendingJson(session.id, pendingJson);

    const m1 = await ctx.messages.append(session.id, "user", textBlocks("only"));

    await ctx.conn.transaction(async (tx) => {
      await truncateTailInTransaction(createTruncateTailDepsFromTx(tx), {
        projectId: project.id,
        sessionId: session.id,
        afterSeq: m1.seq,
        sweepRevisions: false,
      });
    });

    const updated = await ctx.sessions.get(session.id);
    assert.equal(updated.userVfsPendingJson, pendingJson);
  });
});
