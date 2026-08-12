/**
 * VFS N+1 修复验证：T-SC1（scanContents 批量读 blob）、T-DEL2（deleteVfsPrefix 批量删）、
 * T-GC2（blob GC 单条 DELETE）。
 *
 * 三个用例共用一套带 SQL 计数的内存库 fixture：open 后用 CountingConnection 包一层，
 * 再 bootstrap + 建 services，这样业务 SQL 全程被计数，写完数据后 clear 再断言。
 *
 * @module test/vfs/vfs-n-plus-1-fixes
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  openSqlCountingNovelMasterTestConnection,
} from "../helpers/sql-counting-connection.js";

import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { runDeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import { deleteVfsPrefix } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { scopeKey } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";

/** 带 SQL 计数的测试上下文：conn 是装饰过的，counter 和它一对一。 */
type CountedCtx = Awaited<ReturnType<typeof openSqlCountingNovelMasterTestConnection>>;

let ctx: CountedCtx | undefined;

before(async () => {
  ctx = await openSqlCountingNovelMasterTestConnection();
});

after(async () => {
  if (ctx != null) {
    await ctx.conn.close();
    ctx = undefined;
  }
});

function getCtx(): CountedCtx {
  if (ctx == null) {
    throw new Error(" CountedCtx 未初始化");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// T-SC1：scanContents 500 文件 blob SELECT ≤ 2
// ---------------------------------------------------------------------------

describe("T-SC1 scanContents 批量读 blob", () => {
  it("500 文件 grep 只发 ≤ 2 条 vfs_content_blob SELECT", async () => {
    const c = getCtx();
    const project = await c.projects.create("p-sc1");
    const vfs = c.projectVfs(project.id);

    // 写 500 个内容不同的文件（确保 500 个不同 blob hash），每个都含 needle。
    const N = 500;
    for (let i = 0; i < N; i++) {
      const body = `file-${i}-needle-${Math.random()}`;
      await vfs.write(`/docs/f${i}.md`, body);
    }

    // 写入阶段会发大量 SQL，清掉后再 grep，只统计读取路径。
    c.counter.clear();
    const matches = await vfs.grep("needle", { pathPrefix: "/docs" });

    // grep 命中全部 500 文件，证明 scanContents 正常解出明文。
    assert.equal(matches.length, N);

    // resolveScanRows 改成 getMany 后，500 文件一块（≤500）只需 1 条 blob SELECT；
    // 留 ≤ 2 的余量兼容未来分块边界调整。
    const blobSelects = c.counter.countBySubstring(
      "FROM vfs_content_blob WHERE content_hash IN",
    );
    assert.ok(
      blobSelects <= 2,
      `blob SELECT 次数应 ≤ 2，实际 ${blobSelects}`,
    );
  });
});

// ---------------------------------------------------------------------------
// T-DEL2：deleteVfsPrefix 100 文件 DELETE = 1 + 空 prefix 不抛
// ---------------------------------------------------------------------------

describe("T-DEL2 deleteVfsPrefix 批量删", () => {
  it("删 100 文件只发 1 条 DELETE FROM vfs_entry", async () => {
    const c = getCtx();
    const project = await c.projects.create("p-del2");
    const vfs = c.projectVfs(project.id);

    const N = 100;
    for (let i = 0; i < N; i++) {
      await vfs.write(`/tree/f${i}.md`, `body-${i}`);
    }

    const sk = scopeKey({ kind: "project", projectId: project.id });
    const repo = new SqliteVfsEntryRepository(c.conn);

    c.counter.clear();
    await deleteVfsPrefix(repo, sk, "/tree");

    const entryDeletes = c.counter.countBySubstring("DELETE FROM vfs_entry");
    assert.equal(
      entryDeletes,
      1,
      `DELETE FROM vfs_entry 次数应为 1，实际 ${entryDeletes}`,
    );

    // 删完后 /tree 下应空（用 repo 探测，不依赖 vfs.list 对不存在路径的 NOT_FOUND 语义）。
    const repo2 = new SqliteVfsEntryRepository(c.conn);
    const remaining = await repo2.listEntriesUnderPrefix(sk, "/tree");
    assert.equal(remaining.length, 0);
  });

  it("空 prefix（目录已空）不抛异常，静默返回", async () => {
    const c = getCtx();
    const project = await c.projects.create("p-del2-empty");
    const sk = scopeKey({ kind: "project", projectId: project.id });
    const repo = new SqliteVfsEntryRepository(c.conn);

    // 该 project 还没写过任何文件，prefix 下为空，不应抛 vfsNotFound。
    c.counter.clear();
    await assert.doesNotReject(() => deleteVfsPrefix(repo, sk, "/none"));
    // 空探测不应发 DELETE。
    assert.equal(c.counter.countBySubstring("DELETE FROM vfs_entry"), 0);
  });
});

// ---------------------------------------------------------------------------
// T-GC2：blob GC 500 孤立 blob DELETE = 1，且不再全表扫引用集
// ---------------------------------------------------------------------------

describe("T-GC2 blob GC 单条 DELETE", () => {
  it("500 孤立 blob 只发 1 条 DELETE FROM vfs_content_blob", async () => {
    const c = getCtx();
    const store = new SqliteVfsContentStore(c.conn);

    // 直接 put 500 个内容不同的孤立 blob（无 entry / revision 引用）。
    const N = 500;
    for (let i = 0; i < N; i++) {
      await store.put(`orphan-blob-${i}-${Math.random()}`);
    }

    c.counter.clear();
    const deleted = await runDeferredBlobGc(c.conn);

    assert.equal(
      deleted,
      N,
      `应清扫 ${N} 个孤立 blob，实际 ${deleted}`,
    );

    // gc 改成 NOT IN 子查询后，孤立 blob 清扫只需 1 条 DELETE。
    const blobDeletes = c.counter.countBySubstring(
      "DELETE FROM vfs_content_blob",
    );
    assert.equal(
      blobDeletes,
      1,
      `DELETE FROM vfs_content_blob 次数应为 1，实际 ${blobDeletes}`,
    );

    // cr-p1-2 删掉 collectAllReferencedHashes 后，runDeferredBlobGc 不再独立发出
    // 「扫 entry / revision 引用集」的 SELECT——gc 的 NOT IN 子查询嵌在同一条 DELETE
    // 语句里，不会单独成为 query 记录。这里双保险：断言 entry 和 revision 两条引用集
    // SELECT 都没有作为独立语句发出。
    const standaloneEntrySelects = c.counter
      .all()
      .filter((r) =>
        r.sql.startsWith("SELECT content_hash FROM vfs_entry"),
      ).length;
    const standaloneRevisionSelects = c.counter
      .all()
      .filter((r) =>
        r.sql.startsWith("SELECT content_hash FROM vfs_revision"),
      ).length;
    assert.equal(
      standaloneEntrySelects,
      0,
      `不应再独立发出 vfs_entry 引用集 SELECT，实际 ${standaloneEntrySelects}`,
    );
    assert.equal(
      standaloneRevisionSelects,
      0,
      `不应再独立发出 vfs_revision 引用集 SELECT，实际 ${standaloneRevisionSelects}`,
    );
  });
});
