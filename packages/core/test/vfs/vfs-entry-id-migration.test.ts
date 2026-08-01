/**
 * T-M1~T-M5 + 新库 no-op：vfs-entry-id-redesign-v1 migration 覆盖。
 *
 * 覆盖 SPEC Step 2 全部迁移测试用例：
 * - T-M1：100 文件 / 500 revision / 100 checkpoint 正确迁移，entry_id 唯一自增，ref_count 正确
 * - T-M2：失败重启续跑（migration id 幂等 + PRAGMA 探测）
 * - T-M3：找不到 entry_id 的 checkpoint 行丢弃
 * - T-M4：3 个触发器存在且 INSERT/DELETE revision 时 blob ref_count ±1
 * - T-M5：vfs_entry 无 version/storage_kind/external_uri 列
 * - 新库路径：canonical DDL 直接建新 schema → migration up() no-op（PRAGMA 探测）
 *
 * @module test/vfs/vfs-entry-id-migration
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapNovelMaster,
  open,
  type TdbcConnection,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import {
  isSchemaMigrationApplied,
  VFS_ENTRY_ID_REDESIGN_V1_ID,
  vfsEntryIdRedesignV1Up,
} from "@/bootstrap/schema-migrations/index.js";
import { inferScopeFromPhysicalPath } from "@/domain/vfs/logic/infer-scope-from-path.js";

async function openMemory(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  return open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

async function columnNames(
  conn: TdbcConnection,
  table: string,
): Promise<Set<string>> {
  const rows = await conn.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${table}')`,
  );
  return new Set(rows.map((r) => String(r.name)));
}

async function columnPk(
  conn: TdbcConnection,
  table: string,
): Promise<Map<string, number>> {
  const rows = await conn.query<{ name: string; pk: number }>(
    `PRAGMA table_info(${table})`,
  );
  return new Map(rows.map((r) => [String(r.name), Number(r.pk ?? 0)]));
}

/** 模拟迁移前旧库形态（entry-id migration 跑之前的那一刻）。 */
async function seedLegacySchema(conn: TdbcConnection): Promise<void> {
  // vfs_entry：旧 path 主键形态 + 冗余列 version/storage_kind/external_uri
  await conn.execute(`
    CREATE TABLE vfs_entry (
      path TEXT PRIMARY KEY,
      content TEXT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      head_version INTEGER NOT NULL DEFAULT 1,
      mtime_ms INTEGER NOT NULL,
      storage_kind TEXT NOT NULL DEFAULT 'inline',
      external_uri TEXT,
      entry_kind TEXT NOT NULL DEFAULT 'file',
      content_hash TEXT NULL
    )
  `);
  // vfs_revision：旧 path 主键形态 + content/storage_kind 冗余列（ref_count 已由前序
  // vfs-revision-ref-count-v1 migration 补上，故 fixture 也带上）
  await conn.execute(`
    CREATE TABLE vfs_revision (
      path TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT,
      status TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      storage_kind TEXT NOT NULL DEFAULT 'inline',
      content_hash TEXT NULL,
      ref_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (path, version)
    )
  `);
  // vfs_content_blob：旧形态无 ref_count 列
  await conn.execute(`
    CREATE TABLE vfs_content_blob (
      content_hash TEXT PRIMARY KEY,
      encoding TEXT NOT NULL,
      bytes BLOB NOT NULL,
      byte_len INTEGER NOT NULL
    )
  `);
  // message_checkpoint_file：旧 logical_path 形态
  await conn.execute(`
    CREATE TABLE message_checkpoint (
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (session_id, message_id)
    )
  `);
  await conn.execute(`
    CREATE TABLE message_checkpoint_file (
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      logical_path TEXT NOT NULL,
      revision_version INTEGER NOT NULL,
      PRIMARY KEY (session_id, message_id, logical_path)
    )
  `);
  // chat_session / chat_project：checkpoint 回填 JOIN 需要
  await conn.execute(`
    CREATE TABLE chat_project (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `);
  await conn.execute(`
    CREATE TABLE chat_session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `);
}

const PROJECT_ID = "proj-1";
const SESSION_ID = "sess-1";
const FILE_COUNT = 100;
const REVISIONS_PER_FILE = 5;
const CHECKPOINT_COUNT = 100;

/**
 * 灌入样本数据：3 种 scope 混合（session / project template / global template），
 * 每文件 5 个 revision 共享同一 blob hash，外加一条孤儿 checkpoint 行。
 *
 * 返回期望值供断言使用。
 */
async function seedLegacyData(conn: TdbcConnection): Promise<{
  totalEntries: number;
  totalRevisions: number;
  expectedCheckpoints: number;
  blobRefCount: number;
}> {
  const now = Date.now();

  await conn.execute(
    `INSERT INTO chat_project (id, name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)`,
    [PROJECT_ID, "P", now, now],
  );
  await conn.execute(
    `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)`,
    [SESSION_ID, PROJECT_ID, "S", now, now],
  );

  // 100 个文件分三种 scope：
  // - 0..49：session scope /projects/{pid}/sessions/{sid}/file{i}.md
  // - 50..79：project template scope /projects/{pid}/template/file{i}.md
  // - 80..99：global template scope /template/file{i}.md
  for (let i = 0; i < FILE_COUNT; i++) {
    let physical: string;
    if (i < 50) {
      physical = `/projects/${PROJECT_ID}/sessions/${SESSION_ID}/file${i}.md`;
    } else if (i < 80) {
      physical = `/projects/${PROJECT_ID}/template/file${i}.md`;
    } else {
      physical = `/template/file${i}.md`;
    }
    const blobHash = `blob_${i}`;
    await conn.execute(
      `INSERT INTO vfs_entry (path, content, version, head_version, mtime_ms, storage_kind, entry_kind, content_hash)
       VALUES (?, NULL, ?, ?, ?, 'inline', 'file', ?)`,
      [physical, REVISIONS_PER_FILE, REVISIONS_PER_FILE, now, blobHash],
    );
    // blob 行（旧形态无 ref_count）
    await conn.execute(
      `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len) VALUES (?, 'zlib', ?, ?)`,
      [blobHash, Buffer.from(`content-${i}`), `content-${i}`.length],
    );
    // 5 个 revision 全部指向同一 blob
    for (let v = 1; v <= REVISIONS_PER_FILE; v++) {
      await conn.execute(
        `INSERT INTO vfs_revision (path, version, content, status, mtime_ms, storage_kind, content_hash, ref_count)
         VALUES (?, ?, NULL, 'active', ?, 'inline', ?, ?)`,
        [physical, v, now, blobHash, v === REVISIONS_PER_FILE ? 1 : 0],
      );
    }
  }

  // 100 条 checkpoint 指向 session scope 文件（file0..file99 → 取 file{i % 50}）
  for (let c = 0; c < CHECKPOINT_COUNT; c++) {
    const fileIdx = c % 50;
    const logicalPath = `/file${fileIdx}.md`;
    await conn.execute(
      `INSERT INTO message_checkpoint (session_id, message_id, created_at_ms) VALUES (?, ?, ?)`,
      [SESSION_ID, `msg-${c}`, now],
    );
    await conn.execute(
      `INSERT INTO message_checkpoint_file (session_id, message_id, logical_path, revision_version)
       VALUES (?, ?, ?, ?)`,
      [SESSION_ID, `msg-${c}`, logicalPath, REVISIONS_PER_FILE],
    );
  }

  // 孤儿 checkpoint：指向不存在的文件，迁移时应被丢弃
  await conn.execute(
    `INSERT INTO message_checkpoint (session_id, message_id, created_at_ms) VALUES (?, ?, ?)`,
    [SESSION_ID, `msg-orphan`, now],
  );
  await conn.execute(
    `INSERT INTO message_checkpoint_file (session_id, message_id, logical_path, revision_version)
     VALUES (?, ?, ?, ?)`,
    [SESSION_ID, `msg-orphan`, `/nonexistent.md`, 1],
  );

  return {
    totalEntries: FILE_COUNT,
    totalRevisions: FILE_COUNT * REVISIONS_PER_FILE,
    expectedCheckpoints: CHECKPOINT_COUNT, // 孤儿行不计
    blobRefCount: REVISIONS_PER_FILE, // 每个 blob 被 5 个 revision 引用
  };
}

describe("inferScopeFromPhysicalPath", () => {
  it("正确反解三种 scope 且顺序敏感（projects 优先于 template）", () => {
    const session = inferScopeFromPhysicalPath(
      `/projects/p1/sessions/s1/a/b.md`,
    );
    assert.equal(session.scopeKey, "session:p1:s1");
    assert.equal(session.logicalPath, "/a/b.md");

    const project = inferScopeFromPhysicalPath(
      `/projects/p1/template/x.md`,
    );
    assert.equal(project.scopeKey, "project:p1");
    assert.equal(project.logicalPath, "/x.md");

    const global = inferScopeFromPhysicalPath(`/template/y.md`);
    assert.equal(global.scopeKey, "global");
    assert.equal(global.logicalPath, "/y.md");

    // 关键：/projects/{pid}/template 不能被误判为 global
    const projectTemplate = inferScopeFromPhysicalPath(
      `/projects/p1/template/sub/z.md`,
    );
    assert.equal(projectTemplate.scopeKey, "project:p1");
    assert.equal(projectTemplate.logicalPath, "/sub/z.md");
  });

  it("无法识别的路径抛 INVALID_PATH", () => {
    assert.throws(
      () => inferScopeFromPhysicalPath("/random/unknown/prefix.md"),
      /INVALID_PATH/,
    );
  });
});

describe("vfs-entry-id-redesign-v1 migration", () => {
  it("T-M1: 100 文件 / 500 revision / 100 checkpoint 正确迁移", async () => {
    const conn = await openMemory();
    try {
      await seedLegacySchema(conn);
      const expected = await seedLegacyData(conn);

      await bootstrapNovelMaster(conn);

      // migration 已登记
      assert.equal(
        await isSchemaMigrationApplied(conn, VFS_ENTRY_ID_REDESIGN_V1_ID),
        true,
      );

      // vfs_entry 行数 + entry_id 唯一自增
      const entryRows = await conn.query<{
        n: number;
        min_id: number;
        max_id: number;
        dup: number;
      }>(`
        SELECT COUNT(*) AS n,
               MIN(entry_id) AS min_id,
               MAX(entry_id) AS max_id,
               COUNT(entry_id) - COUNT(DISTINCT entry_id) AS dup
        FROM vfs_entry
      `);
      assert.equal(Number(entryRows[0]!.n), expected.totalEntries);
      assert.equal(Number(entryRows[0]!.dup), 0, "entry_id 必须唯一");
      assert.equal(
        Number(entryRows[0]!.max_id) - Number(entryRows[0]!.min_id) + 1,
        expected.totalEntries,
        "entry_id 必须连续自增",
      );

      // revision 行数 + 按 entry_id 寻址
      const revRows = await conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM vfs_revision`,
      );
      assert.equal(Number(revRows[0]!.n), expected.totalRevisions);

      // checkpoint 行数（孤儿被丢弃）
      const cpRows = await conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM message_checkpoint_file`,
      );
      assert.equal(
        Number(cpRows[0]!.n),
        expected.expectedCheckpoints,
        "孤儿 checkpoint 行应被丢弃",
      );

      // blob ref_count：每个 blob 被 5 个 revision 引用
      const blobRows = await conn.query<{
        content_hash: string;
        ref_count: number;
      }>(`SELECT content_hash, ref_count FROM vfs_content_blob ORDER BY content_hash`);
      assert.equal(blobRows.length, expected.totalEntries);
      for (const row of blobRows) {
        assert.equal(
          Number(row.ref_count),
          expected.blobRefCount,
          `blob ${row.content_hash} ref_count 应为 ${expected.blobRefCount}`,
        );
      }

      // 三种 scope 都正确反解
      const sessionEntry = await conn.query<{
        scope_key: string;
        path: string;
      }>(
        `SELECT scope_key, path FROM vfs_entry WHERE path = ? AND scope_key = ?`,
        ["/file0.md", `session:${PROJECT_ID}:${SESSION_ID}`],
      );
      assert.equal(sessionEntry.length, 1);

      const projectEntry = await conn.query<{
        scope_key: string;
        path: string;
      }>(
        `SELECT scope_key, path FROM vfs_entry WHERE path = ? AND scope_key = ?`,
        ["/file50.md", `project:${PROJECT_ID}`],
      );
      assert.equal(projectEntry.length, 1);

      const globalEntry = await conn.query<{
        scope_key: string;
        path: string;
      }>(
        `SELECT scope_key, path FROM vfs_entry WHERE path = ? AND scope_key = ?`,
        ["/file80.md", "global"],
      );
      assert.equal(globalEntry.length, 1);
    } finally {
      await conn.close();
    }
  });

  it("T-M2: 二次 bootstrap 可重入（migration id 幂等 + PRAGMA 探测）", async () => {
    const conn = await openMemory();
    try {
      await seedLegacySchema(conn);
      await seedLegacyData(conn);

      await bootstrapNovelMaster(conn);
      const entriesAfterFirst = await conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM vfs_entry`,
      );
      const revisionsAfterFirst = await conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM vfs_revision`,
      );

      // 二次 bootstrap：快路径（bootVersion 已 = 2），migration 已 applied 应跳过
      await bootstrapNovelMaster(conn);
      const entriesAfterSecond = await conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM vfs_entry`,
      );
      const revisionsAfterSecond = await conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM vfs_revision`,
      );

      assert.equal(
        Number(entriesAfterFirst[0]!.n),
        Number(entriesAfterSecond[0]!.n),
        "二次 bootstrap 后 vfs_entry 行数不应变",
      );
      assert.equal(
        Number(revisionsAfterFirst[0]!.n),
        Number(revisionsAfterSecond[0]!.n),
        "二次 bootstrap 后 vfs_revision 行数不应变",
      );
    } finally {
      await conn.close();
    }
  });

  it("T-M3: 找不到 entry_id 的 checkpoint 行丢弃", async () => {
    const conn = await openMemory();
    // 临时把 console.warn 换成收集器，验证迁移真的对孤儿行发了 warning
    const originalWarn = console.warn;
    const warns: string[] = [];
    console.warn = (...args: unknown[]) => {
      warns.push(args.join(" "));
    };
    try {
      await seedLegacySchema(conn);
      const now = Date.now();
      await conn.execute(
        `INSERT INTO chat_project (id, name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)`,
        ["p", "P", now, now],
      );
      await conn.execute(
        `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)`,
        ["s", "p", "S", now, now],
      );
      // 只有一条存在的文件
      await conn.execute(
        `INSERT INTO vfs_entry (path, content, version, head_version, mtime_ms, storage_kind, entry_kind, content_hash)
         VALUES ('/projects/p/sessions/s/real.md', NULL, 1, 1, ?, 'inline', 'file', 'blob_real')`,
        [now],
      );
      await conn.execute(
        `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len) VALUES (?, 'zlib', ?, ?)`,
        ["blob_real", Buffer.from("x"), 1],
      );
      await conn.execute(
        `INSERT INTO vfs_revision (path, version, content, status, mtime_ms, storage_kind, content_hash, ref_count)
         VALUES ('/projects/p/sessions/s/real.md', 1, NULL, 'active', ?, 'inline', 'blob_real', 1)`,
        [now],
      );
      // 存在的 checkpoint
      await conn.execute(
        `INSERT INTO message_checkpoint VALUES (?, ?, ?)`,
        ["s", "m1", now],
      );
      await conn.execute(
        `INSERT INTO message_checkpoint_file VALUES (?, ?, ?, ?)`,
        ["s", "m1", "/real.md", 1],
      );
      // 孤儿 checkpoint（文件不存在）
      await conn.execute(
        `INSERT INTO message_checkpoint VALUES (?, ?, ?)`,
        ["s", "m2", now],
      );
      await conn.execute(
        `INSERT INTO message_checkpoint_file VALUES (?, ?, ?, ?)`,
        ["s", "m2", "/ghost.md", 1],
      );

      await bootstrapNovelMaster(conn);

      const rows = await conn.query<{
        message_id: string;
        entry_id: number;
      }>(`SELECT message_id, entry_id FROM message_checkpoint_file ORDER BY message_id`);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.message_id, "m1");
      assert.ok(Number(rows[0]!.entry_id) > 0);

      // 孤儿 checkpoint 被丢弃时应发 warning（含「丢弃」/「孤儿」字样）
      const joined = warns.join(" ");
      assert.ok(
        joined.includes("丢弃") || joined.includes("孤儿"),
        `迁移应发出孤儿 checkpoint 丢弃 warning，实际 warns=${joined}`,
      );
    } finally {
      console.warn = originalWarn;
      await conn.close();
    }
  });

  it("T-M4: 3 个触发器存在且 INSERT/DELETE revision 时 blob ref_count ±1", async () => {
    const conn = await openMemory();
    try {
      await seedLegacySchema(conn);
      await seedLegacyData(conn);
      await bootstrapNovelMaster(conn);

      // 3 个触发器都存在
      const triggers = await conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_revision_%' ORDER BY name`,
      );
      const triggerNames = triggers.map((r) => String(r.name));
      assert.ok(triggerNames.includes("trg_revision_insert_inc_blob_ref"));
      assert.ok(triggerNames.includes("trg_revision_delete_dec_blob_ref"));
      assert.ok(triggerNames.includes("trg_revision_update_transfer_blob_ref"));

      // 拿一个已有 entry + blob 做触发器验证
      const target = await conn.query<{
        entry_id: number;
        content_hash: string;
      }>(
        `SELECT e.entry_id, e.content_hash FROM vfs_entry e WHERE e.entry_kind = 'file' LIMIT 1`,
      );
      const entryId = Number(target[0]!.entry_id);
      const blobHash = String(target[0]!.content_hash);

      const refBefore = await conn.query<{ ref_count: number }>(
        `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
        [blobHash],
      );
      const before = Number(refBefore[0]!.ref_count);

      // INSERT 一条 revision → ref_count + 1
      await conn.execute(
        `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, content_hash, ref_count)
         VALUES (?, 999, 'active', ?, ?, 0)`,
        [entryId, Date.now(), blobHash],
      );
      const refAfterInsert = await conn.query<{ ref_count: number }>(
        `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
        [blobHash],
      );
      assert.equal(
        Number(refAfterInsert[0]!.ref_count),
        before + 1,
        "INSERT revision 后 blob ref_count 应 +1",
      );

      // DELETE 那条 revision → ref_count - 1
      await conn.execute(
        `DELETE FROM vfs_revision WHERE entry_id = ? AND version = 999`,
        [entryId],
      );
      const refAfterDelete = await conn.query<{ ref_count: number }>(
        `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
        [blobHash],
      );
      assert.equal(
        Number(refAfterDelete[0]!.ref_count),
        before,
        "DELETE revision 后 blob ref_count 应 -1",
      );

      // UPDATE content_hash 时触发转移逻辑：旧 hash -1、新 hash +1。
      // 取一个已有 revision 行，把它的 content_hash 换成另一个已存在的 blob。
      const updRev = await conn.query<{
        entry_id: number;
        version: number;
        content_hash: string;
      }>(`SELECT entry_id, version, content_hash FROM vfs_revision WHERE content_hash IS NOT NULL LIMIT 1`);
      const updEntryId = Number(updRev[0]!.entry_id);
      const updVersion = Number(updRev[0]!.version);
      const oldHash = String(updRev[0]!.content_hash);
      const newHash = "blob_update_target";
      // 新 blob 先建好行——UPDATE 触发器只会对已存在的 blob 行 +1，不会自动新建
      await conn.execute(
        `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len) VALUES (?, 'zlib', ?, ?)`,
        [newHash, Buffer.from("target"), 6],
      );

      const updOldBefore = Number(
        (
          await conn.query<{ ref_count: number }>(
            `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
            [oldHash],
          )
        )[0]!.ref_count,
      );
      const updNewBefore = Number(
        (
          await conn.query<{ ref_count: number }>(
            `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
            [newHash],
          )
        )[0]!.ref_count,
      );

      await conn.execute(
        `UPDATE vfs_revision SET content_hash = ? WHERE entry_id = ? AND version = ?`,
        [newHash, updEntryId, updVersion],
      );

      const updOldAfter = Number(
        (
          await conn.query<{ ref_count: number }>(
            `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
            [oldHash],
          )
        )[0]!.ref_count,
      );
      const updNewAfter = Number(
        (
          await conn.query<{ ref_count: number }>(
            `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
            [newHash],
          )
        )[0]!.ref_count,
      );
      assert.equal(
        updOldAfter,
        updOldBefore - 1,
        "UPDATE content_hash 后旧 blob ref_count 应 -1",
      );
      assert.equal(
        updNewAfter,
        updNewBefore + 1,
        "UPDATE content_hash 后新 blob ref_count 应 +1",
      );
    } finally {
      await conn.close();
    }
  });

  it("T-M5: vfs_entry 无 version/storage_kind/external_uri 列（V6）", async () => {
    const conn = await openMemory();
    try {
      await seedLegacySchema(conn);
      await seedLegacyData(conn);
      await bootstrapNovelMaster(conn);

      const cols = await columnNames(conn, "vfs_entry");
      assert.ok(cols.has("entry_id"), "应有 entry_id");
      assert.ok(cols.has("scope_key"), "应有 scope_key");
      assert.ok(cols.has("path"), "应有 path");
      assert.ok(cols.has("head_version"), "应保留 head_version");
      assert.ok(cols.has("entry_kind"), "应保留 entry_kind");
      assert.ok(cols.has("content"), "应保留 content TEXT NULL");
      assert.ok(cols.has("content_hash"), "应保留 content_hash");
      assert.ok(!cols.has("version"), "不应再有 version 列");
      assert.ok(!cols.has("storage_kind"), "不应再有 storage_kind 列");
      assert.ok(!cols.has("external_uri"), "不应再有 external_uri 列");

      // 主键应为 entry_id
      const pk = await columnPk(conn, "vfs_entry");
      assert.ok((pk.get("entry_id") ?? 0) > 0, "entry_id 应为主键");
      assert.equal(pk.get("path") ?? 0, 0, "path 不应再是主键");

      // vfs_revision 也不应有 path/content/storage_kind 列
      const revCols = await columnNames(conn, "vfs_revision");
      assert.ok(revCols.has("entry_id"));
      assert.ok(revCols.has("ref_count"));
      assert.ok(!revCols.has("path"));
      assert.ok(!revCols.has("content"));
      assert.ok(!revCols.has("storage_kind"));

      // message_checkpoint_file 不应有 logical_path，应有 entry_id
      const cpCols = await columnNames(conn, "message_checkpoint_file");
      assert.ok(cpCols.has("entry_id"));
      assert.ok(!cpCols.has("logical_path"));
    } finally {
      await conn.close();
    }
  });

  it("T-M6: 脏 path（无法反解 scope）跳过且不阻塞迁移", async () => {
    const conn = await openMemory();
    try {
      await seedLegacySchema(conn);
      const now = Date.now();
      await conn.execute(
        `INSERT INTO chat_project (id, name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)`,
        ["p", "P", now, now],
      );
      await conn.execute(
        `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)`,
        ["s", "p", "S", now, now],
      );
      // 一条正常的 session scope 文件
      await conn.execute(
        `INSERT INTO vfs_entry (path, content, version, head_version, mtime_ms, storage_kind, entry_kind, content_hash)
         VALUES ('/projects/p/sessions/s/real.md', NULL, 1, 1, ?, 'inline', 'file', 'blob_real')`,
        [now],
      );
      await conn.execute(
        `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len) VALUES (?, 'zlib', ?, ?)`,
        ["blob_real", Buffer.from("x"), 1],
      );
      await conn.execute(
        `INSERT INTO vfs_revision (path, version, content, status, mtime_ms, storage_kind, content_hash, ref_count)
         VALUES ('/projects/p/sessions/s/real.md', 1, NULL, 'active', ?, 'inline', 'blob_real', 1)`,
        [now],
      );
      // 两条脏数据：path 不符合任何 scope 物理前缀
      await conn.execute(
        `INSERT INTO vfs_entry (path, content, version, head_version, mtime_ms, storage_kind, entry_kind, content_hash)
         VALUES ('/random/unknown/prefix.md', NULL, 1, 1, ?, 'inline', 'file', 'blob_dirty1')`,
        [now],
      );
      await conn.execute(
        `INSERT INTO vfs_entry (path, content, version, head_version, mtime_ms, storage_kind, entry_kind, content_hash)
         VALUES ('/projects/p', NULL, 1, 1, ?, 'inline', 'file', 'blob_dirty2')`,
        [now],
      );
      for (const hash of ["blob_dirty1", "blob_dirty2"]) {
        await conn.execute(
          `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len) VALUES (?, 'zlib', ?, ?)`,
          [hash, Buffer.from(hash), hash.length],
        );
      }
      // 脏 entry 的 revision 也一起写（迁移时应因 JOIN 不到 _migration_path_map 而丢弃）
      for (const dirtyPath of [
        "/random/unknown/prefix.md",
        "/projects/p",
      ]) {
        await conn.execute(
          `INSERT INTO vfs_revision (path, version, content, status, mtime_ms, storage_kind, content_hash, ref_count)
           VALUES (?, 1, NULL, 'active', ?, 'inline', ?, 1)`,
          [dirtyPath, now, dirtyPath.includes("random") ? "blob_dirty1" : "blob_dirty2"],
        );
      }

      // 不应抛错
      await bootstrapNovelMaster(conn);

      // 正常 entry 迁移成功
      const entries = await conn.query<{ scope_key: string; path: string }>(
        `SELECT scope_key, path FROM vfs_entry ORDER BY path`,
      );
      assert.equal(entries.length, 1, "只保留正常 entry");
      assert.equal(entries[0]!.scope_key, "session:p:s");
      assert.equal(entries[0]!.path, "/real.md");

      // 正常 revision 迁移成功，脏 revision 丢弃
      const revs = await conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM vfs_revision`,
      );
      assert.equal(Number(revs[0]!.n), 1, "脏 entry 的 revision 应一起丢弃");

      // 脏 blob 的 ref_count 保持 0（revision 被丢弃后无引用）
      const dirtyBlobs = await conn.query<{
        content_hash: string;
        ref_count: number;
      }>(
        `SELECT content_hash, ref_count FROM vfs_content_blob WHERE content_hash IN ('blob_dirty1', 'blob_dirty2') ORDER BY content_hash`,
      );
      assert.equal(dirtyBlobs.length, 2);
      for (const row of dirtyBlobs) {
        assert.equal(
          Number(row.ref_count),
          0,
          `脏 blob ${row.content_hash} ref_count 应为 0`,
        );
      }
    } finally {
      await conn.close();
    }
  });

  it("新库路径：canonical DDL 直接建新 schema → migration up() no-op", async () => {
    const conn = await openMemory();
    try {
      // 第一次 bootstrap：canonical DDL 直接建 entry_id 形态新库
      await bootstrapNovelMaster(conn);

      const cols = await columnNames(conn, "vfs_entry");
      assert.ok(cols.has("entry_id"));
      assert.ok(cols.has("scope_key"));
      assert.ok(!cols.has("version"));

      const revCols = await columnNames(conn, "vfs_revision");
      assert.ok(revCols.has("entry_id"));
      assert.ok(!revCols.has("path"));

      // 新库上手动调 migration up()：PRAGMA 探测已是 entry_id 形态 → 直接 return（no-op）
      const entriesBefore = await conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM vfs_entry`,
      );
      await vfsEntryIdRedesignV1Up(conn);
      const entriesAfter = await conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM vfs_entry`,
      );
      assert.equal(
        Number(entriesBefore[0]!.n),
        Number(entriesAfter[0]!.n),
        "新库上调 migration up() 应 no-op",
      );
    } finally {
      await conn.close();
    }
  });
});
