/**
 * T-GC1 / T-GC2：sweep + runDeferredBlobGc 全库 blob gc（唯一算法入口）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sweepSessionRevisions } from "@/domain/message-checkpoint/logic/revision-gc.js";
import { runDeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { hashContent } from "@/domain/vfs/content-store/logic/hash-content.js";
import {
  scopePhysicalPrefix,
  toPhysicalPath,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("sweepSessionRevisions + blob gc", () => {
  it("T-GC1: 不可达 revision 删除后，无引用 blob 被 gc（经唯一入口）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);
    const contentStore = new SqliteVfsContentStore(ctx.conn);

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "w" }],
    });
    await svfs.write("/gc1.md", "keep-live", { versionCheck: false });
    await svfs.write("/gc1.md", "orphan-mid", { versionCheck: false });
    await svfs.write("/gc1.md", "keep-live-v3", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    // 再写一版后不 capture，使中间版 orphan-mid 不可达（live head + checkpoint 都不指它）
    // capture 钉住的是 keep-live-v3；再写会让 orphan-mid 仍不可达
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const physical = toPhysicalPath(scope, "/gc1.md");
    const orphanHash = hashContent("orphan-mid");

    // 确认 orphan-mid revision 存在且 blob 在
    const midKeys = await revisions.listKeysUnderPrefix(
      scopePhysicalPrefix(scope),
    );
    assert.ok(midKeys.some((k) => k.path === physical && k.version === 2));
    assert.equal(await contentStore.get(orphanHash), "orphan-mid");

    await sweepSessionRevisions(
      revisions,
      entries,
      checkpoints,
      project.id,
      session.id,
      ctx.conn,
    );
    await runDeferredBlobGc(ctx.conn);

    const afterKeys = await revisions.listKeysUnderPrefix(
      scopePhysicalPrefix(scope),
    );
    assert.equal(
      afterKeys.some((k) => k.path === physical && k.version === 2),
      false,
    );
    await assert.rejects(() => contentStore.get(orphanHash));
    // live 正文仍可读
    assert.equal((await svfs.read("/gc1.md")).content, "keep-live-v3");
  });

  it("T-GC2: session A sweep 后 gc 不得删除 session B 仍引用的 blob", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const sessionA = await ctx.sessions.create(project.id);
    const sessionB = await ctx.sessions.create(project.id);
    const svfsA = ctx.sessionVfs(project.id, sessionA.id);
    const svfsB = ctx.sessionVfs(project.id, sessionB.id);

    const sharedPlain = `shared-blob-${testIsolationSuffix()}`;
    const onlyA = `only-a-${testIsolationSuffix()}`;

    await svfsA.write("/a.md", onlyA, { versionCheck: false });
    await svfsA.write("/a.md", sharedPlain, { versionCheck: false });
    await svfsB.write("/b.md", sharedPlain, { versionCheck: false });

    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);
    const contentStore = new SqliteVfsContentStore(ctx.conn);

    const onlyAHash = hashContent(onlyA);
    const sharedHash = hashContent(sharedPlain);

    // A 的 v1(onlyA) 在 live 已是 sharedPlain 且无 checkpoint → sweep A 应删 onlyA revision+blob
    await sweepSessionRevisions(
      revisions,
      entries,
      checkpoints,
      project.id,
      sessionA.id,
      ctx.conn,
    );
    await runDeferredBlobGc(ctx.conn);

    await assert.rejects(() => contentStore.get(onlyAHash));
    assert.equal(await contentStore.get(sharedHash), sharedPlain);
    assert.equal((await svfsB.read("/b.md")).content, sharedPlain);
    assert.equal((await svfsA.read("/a.md")).content, sharedPlain);
  });
});
