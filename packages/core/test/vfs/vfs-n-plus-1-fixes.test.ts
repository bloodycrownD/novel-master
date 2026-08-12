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
  bootstrapNovelMaster,
  createPersistentPreferences,
  createPersistentState,
  decode,
  open,
  type PersistentPreferences,
  type PersistentState,
  type TdbcConnection,
} from "@novel-master/core";
import {
  agentDefinitionSchema,
  createAgentRegistryService,
} from "@novel-master/core/agent";
import {
  createMessageService,
  createProjectService,
  createSessionService,
} from "@novel-master/core/chat";
import { createMessageCheckpointService } from "@novel-master/core/message-checkpoint";
import { createSessionFsService } from "@novel-master/core/session-fs";
import { createSessionKkvService } from "@novel-master/core/session-kkv";
import { createScopedVfsService } from "@novel-master/core/vfs";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";

import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { runDeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import { deleteVfsPrefix } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { scopeKey } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";

import {
  CountingConnection,
  SqlCounter,
} from "./n-plus-1-counting-connection.js";

/** 带 SQL 计数的测试上下文：conn 是装饰过的，counter 和它一对一。 */
interface CountedCtx {
  readonly conn: TdbcConnection;
  readonly counter: SqlCounter;
  readonly state: PersistentState;
  readonly preferences: PersistentPreferences;
  readonly projects: ReturnType<typeof createProjectService>;
  readonly sessions: ReturnType<typeof createSessionService>;
  readonly messages: ReturnType<typeof createMessageService>;
  readonly sessionFs: ReturnType<typeof createSessionFsService>;
  readonly sessionKkv: ReturnType<typeof createSessionKkvService>;
  readonly messageCheckpoint: ReturnType<typeof createMessageCheckpointService>;
  projectVfs(projectId: string): ReturnType<typeof createScopedVfsService>;
}

/**
 * 复刻 openNovelMasterTestConnection 的步骤，但在 open() 拿到 conn 后立刻包一层
 * CountingConnection——services 构造时拿到的就是这个装饰过的 conn，后续所有业务
 * SQL 都会被 counter 记到。
 */
async function openCountedNovelMaster(): Promise<CountedCtx> {
  registerBetterSqlite3Driver();
  const rawConn = await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
  const counter = new SqlCounter();
  const conn: TdbcConnection = new CountingConnection(rawConn, counter);
  await bootstrapNovelMaster(conn);

  const state = createPersistentState(conn);
  const agentRegistry = createAgentRegistryService(conn, state);
  await agentRegistry.upsert(
    "test-default-agent",
    decode(
      {
        schemaVersion: 1,
        name: "测试默认 Agent",
        prompts: { persist: {}, dynamic: {} },
      },
      agentDefinitionSchema,
    ),
  );
  await state.setCurrentAgentId("test-default-agent");

  return {
    conn,
    counter,
    state,
    preferences: createPersistentPreferences(conn),
    projects: createProjectService(conn),
    sessions: createSessionService(conn, { state, agentRegistry }),
    messages: createMessageService(conn),
    sessionFs: createSessionFsService(conn),
    sessionKkv: createSessionKkvService(conn),
    messageCheckpoint: createMessageCheckpointService(conn),
    projectVfs: (projectId) =>
      createScopedVfsService(conn, { kind: "project", projectId }),
  };
}

let ctx: CountedCtx | undefined;

before(async () => {
  ctx = await openCountedNovelMaster();
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

    // runDeferredBlobGc 不应再调 collectAllReferencedHashes（那条全表 SELECT 已冗余）。
    // 注意：gc 的 NOT IN 子查询本身嵌了同文本的 SELECT，但它作为 DELETE 语句的一部分
    // 被记录，不会单独成为 key；所以这里检查独立的、以 SELECT 开头的 query key。
    let standaloneReferencedSelects = 0;
    for (const sql of c.counter.entries().keys()) {
      if (sql.startsWith("SELECT content_hash FROM vfs_entry")) {
        standaloneReferencedSelects += 1;
      }
    }
    assert.equal(
      standaloneReferencedSelects,
      0,
      `不应再独立发出 collectAllReferencedHashes 的 SELECT，实际 ${standaloneReferencedSelects}`,
    );
  });
});
