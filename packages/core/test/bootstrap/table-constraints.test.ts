/**
 * T-CT1 / T-CT2 / T-CT3：表设计约束 rebuild migration（table-constraints-v1）覆盖。
 *
 * 覆盖 SPEC Step 11/12/13：
 * - T-CT1：脏值预扫描 + 清洗（非法 role、NULL PK、负 ref_count、非法 algo/json/flags 等）
 * - T-CT2：16 表 rebuild 后约束生效（NOT NULL 拒 NULL、CHECK 拒非法值、WITHOUT ROWID 表
 *   无 rowid 列、boolean CHECK 拒非 0/1、下界 CHECK 拒负值、UNIQUE 拒重复、json_valid 拒非法 JSON）
 * - T-CT3：vfs_revision WITHOUT ROWID 后 revision GC（deleteUnreferencedUnderScope）正常
 *
 * 测试策略：T-CT1/T-CT2 手动用旧（无约束）DDL 建表 → 跑 migration.up → 验证；
 * T-CT3 用正常 bootstrap（新库已带约束）→ 跑 GC → 验证不炸。
 *
 * @module test/bootstrap/table-constraints
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  open,
  type TdbcConnection,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { tableConstraintsV1Up } from "@/bootstrap/schema-migrations/table-constraints-v1.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

/** 打开一个内存库连接。 */
async function openMemoryConn(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  return open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

/**
 * 建出 migration 跑之前的旧形态：列与 canonical 同序，但 PK 列可空、无 CHECK、
 * 非 WITHOUT ROWID（普通 rowid 表）。rebuild 靠 INSERT SELECT * 搬运，列序必须一致。
 */
async function seedLegacyUnconstrainedSchema(conn: TdbcConnection): Promise<void> {
  await conn.execute(`CREATE TABLE chat_project (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    agent_config_json TEXT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`);
  await conn.execute(`CREATE TABLE chat_session (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT,
    composer_draft_json TEXT NULL,
    agent_config_json TEXT NULL,
    parent_session_id TEXT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`);
  await conn.execute(`CREATE TABLE chat_message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    content_json TEXT NOT NULL,
    provider TEXT,
    raw_json TEXT,
    created_at_ms INTEGER NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    attachments_json TEXT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    UNIQUE (session_id, seq)
  )`);
  await conn.execute(`CREATE TABLE message_checkpoint (
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (session_id, message_id)
  )`);
  await conn.execute(`CREATE TABLE message_checkpoint_file (
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    entry_id INTEGER NOT NULL,
    revision_version INTEGER NOT NULL,
    PRIMARY KEY (session_id, message_id, entry_id)
  )`);
  await conn.execute(`CREATE TABLE vfs_entry (
    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope_key TEXT NOT NULL,
    path TEXT NOT NULL,
    content_hash TEXT NULL,
    head_version INTEGER NOT NULL DEFAULT 1,
    mtime_ms INTEGER NOT NULL,
    entry_kind TEXT NOT NULL DEFAULT 'file',
    content TEXT NULL,
    UNIQUE(scope_key, path)
  )`);
  await conn.execute(`CREATE TABLE vfs_revision (
    entry_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    status TEXT NOT NULL,
    mtime_ms INTEGER NOT NULL,
    content_hash TEXT NULL,
    ref_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (entry_id, version)
  )`);
  await conn.execute(`CREATE TABLE vfs_content_blob (
    content_hash TEXT PRIMARY KEY,
    encoding TEXT NOT NULL,
    bytes BLOB NOT NULL,
    byte_len INTEGER NOT NULL,
    ref_count INTEGER NOT NULL DEFAULT 0
  )`);
  await conn.execute(`CREATE TABLE llm_provider (
    id TEXT PRIMARY KEY,
    builtin_key TEXT UNIQUE,
    protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic', 'gemini')),
    base_url TEXT NOT NULL,
    display_name TEXT NOT NULL,
    secret_ref TEXT,
    headers_json TEXT NOT NULL DEFAULT '{}',
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`);
  await conn.execute(`CREATE TABLE llm_saved_model (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    vendor_model_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES llm_provider(id) ON DELETE CASCADE
  )`);
  await conn.execute(`CREATE TABLE regex_group (
    group_id TEXT PRIMARY KEY,
    display_name TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`);
  await conn.execute(`CREATE TABLE regex_rule (
    group_id TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    name TEXT NOT NULL,
    pattern TEXT NOT NULL,
    flags TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    llm_replace TEXT,
    display_replace TEXT,
    start_depth INTEGER,
    end_depth INTEGER,
    scope_user INTEGER NOT NULL DEFAULT 0,
    scope_assistant INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (group_id, rule_id),
    FOREIGN KEY (group_id) REFERENCES regex_group(group_id) ON DELETE CASCADE
  )`);
  await conn.execute(`CREATE TABLE workplace_dir_rule (
    scope_key TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    rule_enabled INTEGER NOT NULL DEFAULT 1,
    sort_field TEXT NOT NULL DEFAULT 'name',
    sort_order TEXT NOT NULL DEFAULT 'asc',
    head_count INTEGER NOT NULL DEFAULT 0,
    tail_count INTEGER NOT NULL DEFAULT 1000,
    fill_policy TEXT NOT NULL DEFAULT 'hidden',
    PRIMARY KEY (scope_key, logical_path)
  )`);
  await conn.execute(`CREATE TABLE workplace_file_rule (
    scope_key TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    inclusion_mode TEXT NOT NULL DEFAULT 'auto',
    PRIMARY KEY (scope_key, logical_path)
  )`);
  await conn.execute(`CREATE TABLE agent_definition (
    agent_id TEXT PRIMARY KEY,
    prompts_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`);
  await conn.execute(`CREATE TABLE sksp_secrets (
    ref TEXT PRIMARY KEY,
    ciphertext BLOB NOT NULL,
    iv BLOB,
    algo TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at_ms INTEGER NOT NULL
  )`);
}

/** 断言给定 SQL 会被约束拒绝（抛错）。 */
async function assertRejected(
  conn: TdbcConnection,
  sql: string,
  params: readonly unknown[],
  label: string,
): Promise<void> {
  await assert.rejects(
    () => conn.execute(sql, params),
    (err: unknown) => {
      assert.ok(err instanceof Error, `${label} 应抛错，但拿到非 Error`);
      return true;
    },
    `${label} 应被约束拒绝，但实际执行成功了`,
  );
}

describe("T-CT1: 脏值预扫描 + 清洗（table-constraints-v1）", () => {
  it("非法 role / hidden / seq、NULL PK、负 ref_count、非法 algo / json / flags 等被清洗或丢弃", async () => {
    const conn = await openMemoryConn();
    await seedLegacyUnconstrainedSchema(conn);

    // chat_message：NULL id（丢弃）、role='bogus'（→user）、hidden=5（→0）、seq=-1（→1）
    await conn.execute(
      `INSERT INTO chat_message (id, session_id, seq, role, content_json, created_at_ms, hidden)
       VALUES (NULL, 's1', -1, 'bogus', '{}', 1, 5)`,
    );
    await conn.execute(
      `INSERT INTO chat_message (id, session_id, seq, role, content_json, created_at_ms, hidden)
       VALUES ('m-clean', 's1', -3, 'bogus', '{}', 1, 9)`,
    );

    // vfs_entry + vfs_revision：version=0（→1）、ref_count=-3（→0）、active+null hash（→deleted）
    await conn.execute(
      `INSERT INTO vfs_entry (scope_key, path, mtime_ms) VALUES ('g1', '/p', 1)`,
    );
    await conn.execute(
      `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, content_hash, ref_count)
       VALUES (1, 0, 'active', 1, NULL, -3)`,
    );

    // vfs_content_blob：NULL content_hash（丢弃）、encoding='bogus'（→zlib）、ref_count=-1（→0）
    await conn.execute(
      `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count)
       VALUES (NULL, 'bogus', x'00', 1, -1)`,
    );
    await conn.execute(
      `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count)
       VALUES ('h1', 'bogus', x'00', 1, -1)`,
    );

    // sksp_secrets：algo='bogus'（→dpapi-v1）、非 dpapi + iv NULL（→dpapi-v1）
    await conn.execute(
      `INSERT INTO sksp_secrets (ref, ciphertext, iv, algo, updated_at_ms)
       VALUES ('k1', x'00', NULL, 'totally-fake', 1)`,
    );
    await conn.execute(
      `INSERT INTO sksp_secrets (ref, ciphertext, iv, algo, updated_at_ms)
       VALUES ('k2', x'00', NULL, 'macos-keychain-aes-gcm-v1', 1)`,
    );

    // llm_saved_model：settings_json='not json'（→'{}'）
    await conn.execute(
      `INSERT INTO llm_provider (id, protocol, base_url, display_name, created_at_ms, updated_at_ms)
       VALUES ('p1', 'openai', 'http://x', 'P', 1, 1)`,
    );
    await conn.execute(
      `INSERT INTO llm_saved_model (id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms)
       VALUES ('sm1', 'p1', 'v', 'M', 'not json', 1, 1)`,
    );

    // regex_rule：flags='xyz'（→''）、enabled=9（→0）、重复 sort_order（去重）
    await conn.execute(
      `INSERT INTO regex_group (group_id, created_at_ms, updated_at_ms) VALUES ('g1', 1, 1)`,
    );
    await conn.execute(
      `INSERT INTO regex_rule (group_id, rule_id, sort_order, name, pattern, flags, enabled, created_at_ms, updated_at_ms)
       VALUES ('g1', 'r1', 5, 'n', 'p', 'xyz', 9, 1, 1)`,
    );
    await conn.execute(
      `INSERT INTO regex_rule (group_id, rule_id, sort_order, name, pattern, created_at_ms, updated_at_ms)
       VALUES ('g1', 'r2', 5, 'n', 'p', 1, 1)`,
    );

    // workplace_dir_rule：fill_policy='bogus'（→header）、head_count=-5（→0）
    await conn.execute(
      `INSERT INTO workplace_dir_rule (scope_key, logical_path, fill_policy, head_count)
       VALUES ('w1', '/d', 'bogus', -5)`,
    );

    // 跑 migration：预扫描清洗 + rebuild。
    await tableConstraintsV1Up(conn);

    // —— 断言清洗结果 ——
    const nullId = await conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM chat_message WHERE id IS NULL`,
    );
    assert.equal(Number(nullId[0]!.n), 0, "NULL id 的 chat_message 应被丢弃");

    const cleaned = await conn.query<{
      role: string;
      hidden: number;
      seq: number;
    }>(
      `SELECT role, hidden, seq FROM chat_message WHERE id = 'm-clean'`,
    );
    assert.equal(cleaned[0]!.role, "user", "非法 role 应清洗成 'user'");
    assert.equal(cleaned[0]!.hidden, 0, "非法 hidden 应清洗成 0");
    assert.equal(cleaned[0]!.seq, 1, "seq < 1 应清洗成 1");

    const rev = await conn.query<{
      version: number;
      ref_count: number;
      status: string;
    }>(
      `SELECT version, ref_count, status FROM vfs_revision WHERE entry_id = 1`,
    );
    assert.equal(rev[0]!.version, 1, "version < 1 应清洗成 1");
    assert.equal(rev[0]!.ref_count, 0, "负 ref_count 应清洗成 0");
    assert.equal(rev[0]!.status, "deleted", "active + NULL content_hash 应清洗成 deleted");

    const nullHash = await conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash IS NULL`,
    );
    assert.equal(Number(nullHash[0]!.n), 0, "NULL content_hash 的 blob 应被丢弃");
    const blob = await conn.query<{ encoding: string; ref_count: number }>(
      `SELECT encoding, ref_count FROM vfs_content_blob WHERE content_hash = 'h1'`,
    );
    assert.equal(blob[0]!.encoding, "zlib", "非法 encoding 应清洗成 'zlib'");
    assert.equal(blob[0]!.ref_count, 0, "负 blob ref_count 应清洗成 0");

    const k1 = await conn.query<{ algo: string }>(
      `SELECT algo FROM sksp_secrets WHERE ref = 'k1'`,
    );
    assert.equal(k1[0]!.algo, "dpapi-v1", "非法 algo 应清洗成 'dpapi-v1'");
    const k2 = await conn.query<{ algo: string }>(
      `SELECT algo FROM sksp_secrets WHERE ref = 'k2'`,
    );
    assert.equal(k2[0]!.algo, "dpapi-v1", "非 dpapi + NULL iv 应清洗 algo 成 'dpapi-v1'");

    const sm = await conn.query<{ settings_json: string }>(
      `SELECT settings_json FROM llm_saved_model WHERE id = 'sm1'`,
    );
    assert.equal(sm[0]!.settings_json, "{}", "非法 settings_json 应清洗成 '{}'");

    const r1 = await conn.query<{ flags: string; enabled: number }>(
      `SELECT flags, enabled FROM regex_rule WHERE group_id = 'g1' AND rule_id = 'r1'`,
    );
    assert.equal(r1[0]!.flags, "", "非法 flags 应清洗成 ''");
    assert.equal(r1[0]!.enabled, 0, "非法 enabled 应清洗成 0");
    const sortOrders = await conn.query<{ sort_order: number }>(
      `SELECT sort_order FROM regex_rule WHERE group_id = 'g1' ORDER BY rule_id`,
    );
    const distinct = new Set(sortOrders.map((r) => Number(r.sort_order)));
    assert.equal(distinct.size, sortOrders.length, "重复 sort_order 应被去重");

    const dir = await conn.query<{ fill_policy: string; head_count: number }>(
      `SELECT fill_policy, head_count FROM workplace_dir_rule WHERE scope_key = 'w1'`,
    );
    assert.equal(dir[0]!.fill_policy, "header", "非法 fill_policy 应清洗成 'header'");
    assert.equal(dir[0]!.head_count, 0, "负 head_count 应清洗成 0");

    await conn.close();
  });
});

describe("T-CT2: 16 表 rebuild 后约束生效（table-constraints-v1）", () => {
  it("NOT NULL / CHECK / WITHOUT ROWID / UNIQUE / json_valid 约束全部生效", async () => {
    const conn = await openMemoryConn();
    await seedLegacyUnconstrainedSchema(conn);
    await tableConstraintsV1Up(conn);

    // —— NOT NULL：TEXT PK 拒 NULL ——
    await assertRejected(
      conn,
      `INSERT INTO chat_message (id, session_id, seq, role, content_json, created_at_ms)
       VALUES (NULL, 's', 1, 'user', '{}', 1)`,
      [],
      "chat_message.id NULL",
    );

    // —— 枚举 CHECK ——
    await assertRejected(
      conn,
      `INSERT INTO chat_message (id, session_id, seq, role, content_json, created_at_ms)
       VALUES ('x', 's', 1, 'bogus', '{}', 1)`,
      [],
      "chat_message.role='bogus'",
    );
    await assertRejected(
      conn,
      `INSERT INTO chat_message (id, session_id, seq, role, content_json, created_at_ms, hidden)
       VALUES ('x', 's', 1, 'user', '{}', 1, 2)`,
      [],
      "chat_message.hidden=2",
    );
    await assertRejected(
      conn,
      `INSERT INTO vfs_entry (scope_key, path, mtime_ms, entry_kind)
       VALUES ('s', '/x', 1, 'bogus')`,
      [],
      "vfs_entry.entry_kind='bogus'",
    );
    await assertRejected(
      conn,
      `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len)
       VALUES ('z', 'bogus', x'00', 1)`,
      [],
      "vfs_content_blob.encoding='bogus'",
    );

    // —— boolean CHECK ——
    await assertRejected(
      conn,
      `INSERT INTO llm_provider (id, protocol, base_url, display_name, is_builtin, created_at_ms, updated_at_ms)
       VALUES ('bp', 'openai', 'http://x', 'P', 5, 1, 1)`,
      [],
      "llm_provider.is_builtin=5",
    );

    // —— 下界 CHECK ——
    await conn.execute(
      `INSERT INTO vfs_entry (scope_key, path, mtime_ms) VALUES ('lb', '/e', 1)`,
    );
    await assertRejected(
      conn,
      `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, ref_count)
       VALUES (1, 1, 'deleted', 1, -1)`,
      [],
      "vfs_revision.ref_count=-1",
    );
    await assertRejected(
      conn,
      `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, ref_count)
       VALUES (1, 0, 'deleted', 1, 0)`,
      [],
      "vfs_revision.version=0",
    );
    await assertRejected(
      conn,
      `INSERT INTO chat_message (id, session_id, seq, role, content_json, created_at_ms)
       VALUES ('neg', 's', 0, 'user', '{}', 1)`,
      [],
      "chat_message.seq=0",
    );

    // —— vfs_revision status-content_hash 耦合 CHECK ——
    await assertRejected(
      conn,
      `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, content_hash, ref_count)
       VALUES (1, 2, 'active', 1, NULL, 0)`,
      [],
      "vfs_revision active + NULL content_hash",
    );

    // —— WITHOUT ROWID：vfs_revision / message_checkpoint / message_checkpoint_file / vfs_content_blob 无 rowid 列 ——
    await assert.rejects(
      () => conn.query(`SELECT rowid FROM vfs_revision LIMIT 1`),
      () => true,
      "WITHOUT ROWID 表不应有 rowid 列",
    );
    await assert.rejects(
      () => conn.query(`SELECT rowid FROM vfs_content_blob LIMIT 1`),
      () => true,
      "vfs_content_blob 不应有 rowid 列",
    );
    await assert.rejects(
      () => conn.query(`SELECT rowid FROM message_checkpoint LIMIT 1`),
      () => true,
      "message_checkpoint 不应有 rowid 列",
    );

    // —— UNIQUE(group_id, sort_order) ——
    await conn.execute(
      `INSERT INTO regex_group (group_id, created_at_ms, updated_at_ms) VALUES ('ug', 1, 1)`,
    );
    await conn.execute(
      `INSERT INTO regex_rule (group_id, rule_id, sort_order, name, pattern, created_at_ms, updated_at_ms)
       VALUES ('ug', 'a', 1, 'n', 'p', 1, 1)`,
    );
    await assertRejected(
      conn,
      `INSERT INTO regex_rule (group_id, rule_id, sort_order, name, pattern, created_at_ms, updated_at_ms)
       VALUES ('ug', 'b', 1, 'n', 'p', 1, 1)`,
      [],
      "regex_rule 重复 (group_id, sort_order)",
    );

    // —— regex flags 字符集 CHECK ——
    await assertRejected(
      conn,
      `INSERT INTO regex_rule (group_id, rule_id, sort_order, name, pattern, flags, created_at_ms, updated_at_ms)
       VALUES ('ug', 'c', 2, 'n', 'p', 'xyz', 1, 1)`,
      [],
      "regex_rule.flags 含非法字符",
    );

    // —— sksp algo + iv 耦合 CHECK ——
    await assertRejected(
      conn,
      `INSERT INTO sksp_secrets (ref, ciphertext, iv, algo, updated_at_ms)
       VALUES ('bad', x'00', NULL, 'totally-fake', 1)`,
      [],
      "sksp_secrets.algo 非法值",
    );
    await assertRejected(
      conn,
      `INSERT INTO sksp_secrets (ref, ciphertext, iv, algo, updated_at_ms)
       VALUES ('bad2', x'00', NULL, 'macos-keychain-aes-gcm-v1', 1)`,
      [],
      "sksp_secrets 非 dpapi + NULL iv",
    );

    // —— json_valid CHECK ——
    await conn.execute(
      `INSERT INTO llm_provider (id, protocol, base_url, display_name, created_at_ms, updated_at_ms)
       VALUES ('jp', 'openai', 'http://x', 'P', 1, 1)`,
    );
    await assertRejected(
      conn,
      `INSERT INTO llm_saved_model (id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms)
       VALUES ('jm', 'jp', 'v', 'M', 'not json', 1, 1)`,
      [],
      "llm_saved_model.settings_json 非法 JSON",
    );
    await assertRejected(
      conn,
      `INSERT INTO agent_definition (agent_id, prompts_json, created_at_ms, updated_at_ms)
       VALUES ('ja', 'not json', 1, 1)`,
      [],
      "agent_definition.prompts_json 非法 JSON",
    );

    await conn.close();
  });
});

novelMasterTestFixture();

describe("T-CT3: vfs_revision WITHOUT ROWID 后 revision GC 正常（决策 4）", () => {
  it("deleteUnreferencedUnderScope 在 WITHOUT ROWID 的 vfs_revision 上不炸", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-ct3-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const repo = new SqliteVfsRevisionRepository(ctx.conn);

    // 确认 vfs_revision 确实是 WITHOUT ROWID 形态。
    await assert.rejects(
      () => ctx.conn.query(`SELECT rowid FROM vfs_revision LIMIT 1`),
      () => true,
      "fixture 的 vfs_revision 应已是 WITHOUT ROWID",
    );

    // 写两个版本再删，制造 ref_count<=0 的可清扫 revision。
    await vfs.write(`/gc/file.txt`, `v1`, { versionCheck: false });
    await vfs.write(`/gc/file.txt`, `v2`, { versionCheck: false });
    await vfs.delete(`/gc/file.txt`);

    // path-scoped 清扫（决策 4 改成 (entry_id, version) IN (...) 后的查询）不应抛错。
    const swept = await repo.deleteUnreferencedUnderScope(
      `session:${project.id}:${session.id}`,
      "/gc",
    );
    assert.ok(
      swept >= 0,
      `deleteUnreferencedUnderScope 应正常返回（>=0），实际 ${swept}`,
    );
  });
});
