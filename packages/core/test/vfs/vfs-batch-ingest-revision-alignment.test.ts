/**
 * CS-06「批量 ingest 走共享 revision 写路径」的验收
 * （fix-spec/wave-c2.md §C2-4 D1/D2/D3/D5 + 测试策略「直查表」口径）。
 *
 * 旧实现 `writeOrUpdateFile` 直接 `repo.update`，**不 append vfs_revision、
 * 不动 ref_count** ⇒ `vfs_entry.head_version` 指向一条根本不存在的版本
 * （悬空 head）。本文件全部用例在旧实现下必红：
 * - D1 直查 `vfs_revision` 是否有 `(entry_id, head_version)` 行；
 * - D2 直查 `ref_count`；
 * - D3 用 checkpoint 钉住该 head（真 head 的 ref 会停在 1 ⇒ 永久不可回收）。
 *
 * 观测面一律用**直查表**，不用「read 必抛/必不抛」——内容寻址缓存命中会让后者失真。
 *
 * @module test/vfs/vfs-batch-ingest-revision-alignment
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createScopedVfsService, createVfsBatchIoService } from "@novel-master/core/vfs";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import {
  openNovelMasterTestConnection,
  type NovelMasterTestContext,
} from "../helpers/novel-master.js";

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("CS-06 批量 ingest 与 revision 层对齐", () => {
  let ctx: NovelMasterTestContext;
  let conn: TdbcConnection;

  before(async () => {
    ctx = await openNovelMasterTestConnection();
    conn = ctx.conn;
  });

  after(async () => {
    await ctx.conn.close();
  });

  /** 某 scope 下所有 entry 的 (path, head_version, 该版本 revision 行数, ref_count)。 */
  async function headTable(scopeKey: string): Promise<
    Array<{ path: string; head: number; revRows: number; refCount: number }>
  > {
    const rows = await conn.query<{
      path: string;
      head: number;
      rev_rows: number;
      ref_count: number | null;
    }>(
      `SELECT e.path AS path,
              e.head_version AS head,
              (SELECT COUNT(*) FROM vfs_revision r
                WHERE r.entry_id = e.entry_id AND r.version = e.head_version) AS rev_rows,
              (SELECT r.ref_count FROM vfs_revision r
                WHERE r.entry_id = e.entry_id AND r.version = e.head_version) AS ref_count
       FROM vfs_entry e
       WHERE e.scope_key = ? AND e.entry_kind = 'file'
       ORDER BY e.path`,
      [scopeKey]
    );
    return rows.map((r) => ({
      path: String(r.path),
      head: Number(r.head),
      revRows: Number(r.rev_rows),
      refCount: Number(r.ref_count ?? -1),
    }));
  }

  it("D1: 批量 ingest（含覆盖写）后每个 head_version 都有对应 vfs_revision 行", async () => {
    const project = await ctx.projects.create(`P-d1-${Date.now()}`);
    const scope = { kind: "project" as const, projectId: project.id };
    const scopeKey = `project:${project.id}`;
    const vfs = createScopedVfsService(conn, scope);
    await vfs.write("/chap/a.md", "old-a");

    const batch = createVfsBatchIoService(conn);
    const plan = await batch.planBatchIngest(scope, "/chap", [
      { kind: "file", relativePath: "a.md", bytes: enc("new-a") },
      { kind: "file", relativePath: "b.md", bytes: enc("B") },
      { kind: "file", relativePath: "sub/c.md", bytes: enc("C") },
    ]);
    const report = await batch.applyBatchIngest(scope, "/chap", plan, {
      overwriteConfirmed: true,
    });
    assert.equal(report.failed.length, 0, JSON.stringify(report.failed));
    assert.deepEqual(report.written.sort(), [
      "/chap/a.md",
      "/chap/b.md",
      "/chap/sub/c.md",
    ]);

    const table = await headTable(scopeKey);
    assert.equal(table.length, 3);
    for (const row of table) {
      assert.equal(
        row.revRows,
        1,
        `${row.path} 的 head_version=${row.head} 没有对应 revision 行（悬空 head）`
      );
    }
    const a = table.find((r) => r.path === "/chap/a.md")!;
    assert.equal(a.head, 2, "覆盖写后 head 应为 2");
  });

  it("D2: 新建 ref=1；覆盖写后旧版本 ref=0、新版本 ref=1", async () => {
    const project = await ctx.projects.create(`P-d2-${Date.now()}`);
    const scope = { kind: "project" as const, projectId: project.id };
    const scopeKey = `project:${project.id}`;
    const vfs = createScopedVfsService(conn, scope);
    await vfs.write("/a.md", "old");

    const batch = createVfsBatchIoService(conn);
    const plan = await batch.planBatchIngest(scope, "/", [
      { kind: "file", relativePath: "a.md", bytes: enc("new") },
      { kind: "file", relativePath: "b.md", bytes: enc("b") },
    ]);
    await batch.applyBatchIngest(scope, "/", plan, { overwriteConfirmed: true });

    const refs = await conn.query<{ entry_id: number; version: number; ref_count: number }>(
      `SELECT r.entry_id, r.version, r.ref_count
       FROM vfs_revision r
       JOIN vfs_entry e ON e.entry_id = r.entry_id
       WHERE e.scope_key = ?
       ORDER BY e.path, r.version`,
      [scopeKey]
    );
    const entryRepo = new SqliteVfsEntryRepository(conn);
    const entryA = (await entryRepo.findByPath(scopeKey, "/a.md"))!;
    const entryB = (await entryRepo.findByPath(scopeKey, "/b.md"))!;
    const byEntry = new Map<number, Array<{ version: number; ref: number }>>();
    for (const r of refs) {
      const list = byEntry.get(Number(r.entry_id)) ?? [];
      list.push({ version: Number(r.version), ref: Number(r.ref_count) });
      byEntry.set(Number(r.entry_id), list);
    }
    assert.deepEqual(byEntry.get(entryA.entryId), [
      { version: 1, ref: 0 },
      { version: 2, ref: 1 },
    ]);
    assert.deepEqual(byEntry.get(entryB.entryId), [{ version: 1, ref: 1 }]);
  });

  it("D3: checkpoint 钉住批量导入的 head 不抛 NOT_FOUND（真 head 的 ref 可回收）", async () => {
    const project = await ctx.projects.create(`P-d3-${Date.now()}`);
    const scope = { kind: "project" as const, projectId: project.id };
    const scopeKey = `project:${project.id}`;
    const session = await ctx.sessions.create(project.id);
    const messageId = (
      await ctx.messages.append(session.id, "user", {
        blocks: [{ type: "text", text: "hi" }],
      })
    ).id;

    const batch = createVfsBatchIoService(conn);
    const plan = await batch.planBatchIngest(scope, "/chap", [
      { kind: "file", relativePath: "pinned.md", bytes: enc("pinned-body") },
    ]);
    await batch.applyBatchIngest(scope, "/chap", plan, { overwriteConfirmed: false });

    const entry = (await new SqliteVfsEntryRepository(conn).findByPath(
      scopeKey,
      "/chap/pinned.md"
    ))!;

    // 旧实现下这里抛 `VfsError NOT_FOUND: Revision not found`。
    await assert.doesNotReject(() =>
      new SqliteMessageCheckpointRepository(conn).insertCheckpoint({
        sessionId: session.id,
        messageId,
        createdAtMs: Date.now(),
        files: [
          {
            entryId: entry.entryId,
            revisionVersion: entry.version,
            path: "/chap/pinned.md",
          },
        ],
      })
    );

    const rows = await conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [entry.entryId, entry.version]
    );
    assert.equal(Number(rows[0]!.ref_count), 2, "live head(1) + checkpoint 持有(1)");
  });

  it("D5: 覆盖写版本单调 —— 既有 v1/v2 后批量 ingest 得 v3，版本连续无洞", async () => {
    const project = await ctx.projects.create(`P-d5-${Date.now()}`);
    const scope = { kind: "project" as const, projectId: project.id };
    const scopeKey = `project:${project.id}`;
    const vfs = createScopedVfsService(conn, scope);
    await vfs.write("/x.md", "v1");
    await vfs.write("/x.md", "v2");

    const batch = createVfsBatchIoService(conn);
    const plan = await batch.planBatchIngest(scope, "/", [
      { kind: "file", relativePath: "x.md", bytes: enc("v3") },
    ]);
    await batch.applyBatchIngest(scope, "/", plan, { overwriteConfirmed: true });

    const rows = await conn.query<{ version: number; ref_count: number }>(
      `SELECT r.version, r.ref_count FROM vfs_revision r
       JOIN vfs_entry e ON e.entry_id = r.entry_id
       WHERE e.scope_key = ? AND e.path = '/x.md'
       ORDER BY r.version`,
      [scopeKey]
    );
    assert.deepEqual(
      rows.map((r) => Number(r.version)),
      [1, 2, 3],
      "版本必须连续无洞"
    );
    assert.equal(
      Number(rows[rows.length - 1]!.ref_count),
      1,
      "live head 持有一份引用"
    );
    const head = (await new SqliteVfsEntryRepository(conn).findByPath(scopeKey, "/x.md"))!;
    assert.equal(head.version, 3);
  });

  it("幂等：同内容再导入一次不新增 revision（共享 writeWithRevision 的同文短路）", async () => {
    const project = await ctx.projects.create(`P-idem-${Date.now()}`);
    const scope = { kind: "project" as const, projectId: project.id };
    const scopeKey = `project:${project.id}`;

    const batch = createVfsBatchIoService(conn);
    const entries = [{ kind: "file" as const, relativePath: "same.md", bytes: enc("same") }];
    await batch.applyBatchIngest(
      scope,
      "/",
      await batch.planBatchIngest(scope, "/", entries),
      { overwriteConfirmed: false }
    );
    const before = await conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_revision r
       JOIN vfs_entry e ON e.entry_id = r.entry_id
       WHERE e.scope_key = ?`,
      [scopeKey]
    );
    await batch.applyBatchIngest(
      scope,
      "/",
      await batch.planBatchIngest(scope, "/", entries),
      { overwriteConfirmed: true }
    );
    const after = await conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_revision r
       JOIN vfs_entry e ON e.entry_id = r.entry_id
       WHERE e.scope_key = ?`,
      [scopeKey]
    );
    assert.equal(Number(after[0]!.n), Number(before[0]!.n), "同文重导入不得新增 revision 行");
    assert.equal((await headTable(scopeKey))[0]!.head, 1);
  });

  it("writeWithRevision 复用：批量通道保留导入链路的外部文件名语义（跳过名校验）", async () => {
    // 牙齿：把 `skipNameValidation` 去掉，本条立刻红（以前能导入的外部文件名
    // 变成「导入失败」，改变了 validate-entry-name.ts 已拍板的导入语义）。
    const project = await ctx.projects.create(`P-name-${Date.now()}`);
    const scope = { kind: "project" as const, projectId: project.id };

    const batch = createVfsBatchIoService(conn);
    const plan = await batch.planBatchIngest(scope, "/", [
      { kind: "file", relativePath: "尾随空格.md ", bytes: enc("x") },
      { kind: "file", relativePath: "控制符\u0001.md", bytes: enc("z") },
      { kind: "file", relativePath: "正常.md", bytes: enc("y") },
    ]);
    const report = await batch.applyBatchIngest(scope, "/", plan, {
      overwriteConfirmed: false,
    });
    assert.equal(report.failed.length, 0, JSON.stringify(report.failed));
    // 尾随空格被 normalizePath 规范化掉；控制符原样保留（这正是「以前能导入」的形态）。
    assert.deepEqual(report.written.sort(), [
      "/尾随空格.md",
      "/控制符\u0001.md",
      "/正常.md",
    ]);

    // 复用共享写路径的另一面：落下的 revision 行与 entry 的 content_hash 同源。
    const rows = await conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_entry e
       WHERE e.scope_key = ?
         AND e.entry_kind = 'file'
         AND NOT EXISTS (
           SELECT 1 FROM vfs_revision r
           WHERE r.entry_id = e.entry_id AND r.content_hash = e.content_hash
         )`,
      [`project:${project.id}`]
    );
    assert.equal(Number(rows[0]!.n), 0, "每个 entry 的 content_hash 都必须有 revision 支撑");
  });
});