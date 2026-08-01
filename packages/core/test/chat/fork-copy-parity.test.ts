/**
 * F1 fork/copy 规则与活树快照 parity（T-F1…T-F6）。
 *
 * entry_id 化后：
 * - `vfs_entry` 按 `scope_key + path` 寻址（path 是逻辑路径）
 * - `vfs_revision` 按 `entry_id + version` 寻址
 * - `content_hash` 列在 `vfs_entry` 和 `vfs_revision` 中均以 entry_id 筛选
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { createWorkplaceService } from "@novel-master/core/workplace";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { scopeKey, toPhysicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("fork/copy parity (F1)", () => {
  it("T-F1 / T-FK1: fork 后目标 revision 可读；源/目标共享同一 content_hash/blob", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/note.md", "fork-body", { versionCheck: false });
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    const m2 = await ctx.messages.append(session.id, "assistant", textBlocks("2"));

    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const sk = scopeKey({ kind: "session", projectId: project.id, sessionId: session.id });
    const sourceEntry = await entries.findByPath(sk, "/note.md");
    assert.ok(sourceEntry != null);
    const sourceHash = await entries.findContentHash(sk, "/note.md");
    assert.ok(sourceHash, "源 entry 须有 content_hash");

    const forked = await ctx.messages.fork(session.id, m2.id);
    const forkedMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(forkedMsgs.length, 2);

    const forkSk = scopeKey({ kind: "session", projectId: project.id, sessionId: forked.id });
    const targetEntry = await entries.findByPath(forkSk, "/note.md");
    assert.ok(targetEntry != null);

    const live = await ctx.sessionVfs(project.id, forked.id).read("/note.md");
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const rev = await revisions.findByEntryAndVersion(targetEntry.entryId, live.version);
    assert.ok(rev, "须存在带 content 的 vfs_revision，不得靠 backfill");
    assert.equal(rev.content, "fork-body");
    assert.equal(rev.status, "active");

    const targetEntryHash = await ctx.conn.query<{ content_hash: string | null }>(
      `SELECT content_hash FROM vfs_entry WHERE entry_id = ?`,
      [targetEntry.entryId],
    );
    const targetRevHash = await ctx.conn.query<{ content_hash: string | null }>(
      `SELECT content_hash FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [targetEntry.entryId, live.version],
    );
    assert.equal(targetEntryHash[0]?.content_hash, sourceHash);
    assert.equal(targetRevHash[0]?.content_hash, sourceHash);

    const blobCount = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?`,
      [sourceHash],
    );
    assert.equal(Number(blobCount[0]!.n), 1, "源/目标须共享同一 blob 行");

    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);
    for (const msg of forkedMsgs) {
      const tree = await checkpoints.loadFileTree(forked.id, msg.id);
      assert.ok(tree, `消息 ${msg.id} 须有 checkpoint`);
      assert.equal(tree.get("/note.md"), live.version);
    }
    // 源消息 id 未参与
    assert.notEqual(forkedMsgs[0]!.id, m1.id);
  });
});
