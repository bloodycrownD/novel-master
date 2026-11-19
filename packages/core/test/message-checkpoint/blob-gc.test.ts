/**
 * T-GC1 / T-GC2：sweep + DeferredBlobGc.run 全库 blob gc（唯一算法入口）。
 *
 * 「blob 行已被回收」的观测面在 2026-09-30 换过一次：此前直接拿
 * `contentStore.get(hash)` 必抛当证据，但 vfs content-store 已接入进程内
 * 解压产物层（infra/content-cache，按内容哈希索引、命中即返回）——同一个
 * hash 只要在本进程里读成功过一次，正文就常驻内存，行缺失不再必然抛错。
 * 于是观测面一分为二（对应两件不同的事）：
 * - **blob 行是否真被删** → 直查 `vfs_content_blob`（GC 本身的判据）；
 * - **缺失时的完整性契约是否还在** → 清空池成冷态后读，必抛。
 */
import { unwrap } from "../helpers/result-unwrap.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RevisionGc } from "@/domain/message-checkpoint/logic/revision-gc.js";
import { DeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { ContentHash } from "@/domain/vfs/content-store/logic/hash-content.js";
import { LogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { decodedContentCache } from "@/infra/content-cache/logic/decoded-content-cache.js";
import type { TdbcConnection } from "@novel-master/core";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** blob 行是否还在（GC 的直接观测面，见文件头）。 */
async function blobRowCount(
  conn: TdbcConnection,
  contentHash: string
): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?",
    [contentHash]
  );
  return Number(rows[0]!.n);
}

/** 行已缺失 + 池冷态 ⇒ 读必走 Err（完整性契约冷态不变；四期后失败通道是 Result.err）。 */
async function assertColdReadRejects(
  store: SqliteVfsContentStore,
  contentHash: string
): Promise<void> {
  decodedContentCache.clear();
  const r = await store.get(contentHash);
  assert.ok(!r.ok, "行已缺失 + 池冷态 ⇒ get 必须返回 Err");
}

describe("RevisionGc.sweepSession + blob gc", () => {
  it("T-GC1: 不可达 revision 删除后，无引用 blob 被 gc（经唯一入口）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const session = unwrap(await ctx.sessions.create(project.id));
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const contentStore = new SqliteVfsContentStore(ctx.conn);

    const assistant = unwrap(await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "w" }],
    }));
    await svfs.write("/gc1.md", "keep-live", { versionCheck: false });
    await svfs.write("/gc1.md", "orphan-mid", { versionCheck: false });
    await svfs.write("/gc1.md", "keep-live-v3", { versionCheck: false });
    unwrap(await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id));

    // 再写一版后不 capture，使中间版 orphan-mid 不可达（live head + checkpoint 都不指它）
    // capture 钉住的是 keep-live-v3；再写会让 orphan-mid 仍不可达
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const physical = LogicalPath.toPhysical(scope, "/gc1.md");
    const orphanHash = ContentHash.hash("orphan-mid");

    // 确认 orphan-mid revision 存在且 blob 在
    const midKeys = await revisions.listKeysUnderScope(
      LogicalPath.scopeKey(scope),
      "/",
    );
    const entry = unwrap(await entries.findByPath(LogicalPath.scopeKey(scope), "/gc1.md"));
    assert.ok(entry != null);
    assert.ok(midKeys.some((k) => k.entryId === entry.entryId && k.version === 2));
    assert.equal(unwrap(await contentStore.get(orphanHash)), "orphan-mid");

    await RevisionGc.sweepSession(revisions, project.id, session.id);
    await DeferredBlobGc.run(ctx.conn);

    const afterKeys = await revisions.listKeysUnderScope(
      LogicalPath.scopeKey(scope),
      "/",
    );
    assert.equal(
      afterKeys.some((k) => k.entryId === entry.entryId && k.version === 2),
      false,
    );
    assert.equal(await blobRowCount(ctx.conn, orphanHash), 0, "orphan blob 行已被 gc");
    await assertColdReadRejects(contentStore, orphanHash);
    // live 正文仍可读
    assert.equal(unwrap(await svfs.read("/gc1.md")).content, "keep-live-v3");
  });

  it("T-GC2: session A sweep 后 gc 不得删除 session B 仍引用的 blob", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const sessionA = unwrap(await ctx.sessions.create(project.id));
    const sessionB = unwrap(await ctx.sessions.create(project.id));
    const svfsA = ctx.sessionVfs(project.id, sessionA.id);
    const svfsB = ctx.sessionVfs(project.id, sessionB.id);

    const sharedPlain = `shared-blob-${testIsolationSuffix()}`;
    const onlyA = `only-a-${testIsolationSuffix()}`;

    await svfsA.write("/a.md", onlyA, { versionCheck: false });
    await svfsA.write("/a.md", sharedPlain, { versionCheck: false });
    await svfsB.write("/b.md", sharedPlain, { versionCheck: false });

    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const contentStore = new SqliteVfsContentStore(ctx.conn);

    const onlyAHash = ContentHash.hash(onlyA);
    const sharedHash = ContentHash.hash(sharedPlain);

    // A 的 v1(onlyA) 在 live 已是 sharedPlain 且无 checkpoint → sweep A 应删 onlyA revision+blob
    await RevisionGc.sweepSession(revisions, project.id, sessionA.id);
    await DeferredBlobGc.run(ctx.conn);

    assert.equal(await blobRowCount(ctx.conn, onlyAHash), 0, "无引用 blob 行已被 gc");
    await assertColdReadRejects(contentStore, onlyAHash);
    assert.equal(unwrap(await contentStore.get(sharedHash)), sharedPlain);
    assert.equal(unwrap(await svfsB.read("/b.md")).content, sharedPlain);
    assert.equal(unwrap(await svfsA.read("/a.md")).content, sharedPlain);
  });
});
