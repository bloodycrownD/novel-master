import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, open, SCHEMA_BOOT_VERSION } from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import type { TdbcConnection } from "@novel-master/tdbc";

/** v10 及更早版本的正则两表 DDL（源自 regex-schema.ts，随系统移除仅存于此作升级夹具）。 */
const LEGACY_REGEX_TABLE_DDL = [
  `CREATE TABLE regex_group (
  group_id TEXT NOT NULL PRIMARY KEY,
  display_name TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
)`,
  `CREATE TABLE regex_rule (
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
  UNIQUE (group_id, sort_order),
  FOREIGN KEY (group_id) REFERENCES regex_group(group_id) ON DELETE CASCADE
)`,
] as const;

/** 在库中植入 v10 形态的正则两表与样例数据，并把 user_version 钉在 10。 */
async function seedLegacyRegexTables(conn: TdbcConnection): Promise<void> {
  for (const ddl of LEGACY_REGEX_TABLE_DDL) {
    await conn.execute(ddl);
  }
  await conn.execute(
    "INSERT INTO regex_group (group_id, display_name, created_at_ms, updated_at_ms) VALUES ('g1', '对话清洗', 1, 1)"
  );
  await conn.execute(
    `INSERT INTO regex_rule (group_id, rule_id, sort_order, name, pattern, flags, enabled, created_at_ms, updated_at_ms)
     VALUES ('g1', 'r1', 0, '去噪', 'foo', '', 1, 1, 1)`
  );
  await conn.execute("PRAGMA user_version = 10");
}

async function listRegexTables(
  conn: TdbcConnection
): Promise<readonly string[]> {
  const rows = await conn.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('regex_group', 'regex_rule')"
  );
  return rows.map((r) => r.name);
}

async function readUserVersion(conn: TdbcConnection): Promise<number> {
  const rows = await conn.query<{ user_version: number }>(
    "PRAGMA user_version"
  );
  return Number(rows[0]?.user_version ?? 0);
}

/** T-RX1：正则系统移除后 schema 幂等清理三场景。 */
describe("regex 表幂等清理（T-RX1）", () => {
  it("v10 存量库（含表与数据）boot 后两表消失且 user_version 推进到当前版本", async () => {
    registerBetterSqlite3Driver();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    await seedLegacyRegexTables(conn);

    await bootstrapNovelMaster(conn);

    assert.deepEqual(await listRegexTables(conn), [], "正则两表应被 DROP");
    assert.equal(await readUserVersion(conn), SCHEMA_BOOT_VERSION, "版本应推进到 SCHEMA_BOOT_VERSION");

    await conn.close();
  });

  it("全新库 boot 后无正则表且 user_version 推进到当前版本", async () => {
    registerBetterSqlite3Driver();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });

    await bootstrapNovelMaster(conn);

    assert.deepEqual(await listRegexTables(conn), []);
    assert.equal(await readUserVersion(conn), SCHEMA_BOOT_VERSION);

    await conn.close();
  });

  it("恢复 v10 备份（user_version 回退且表重现）后再 boot，表再次被清", async () => {
    registerBetterSqlite3Driver();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    await bootstrapNovelMaster(conn);
    assert.equal(await readUserVersion(conn), SCHEMA_BOOT_VERSION);

    // 模拟整库恢复旧备份：user_version 回退到 10 且正则两表重现（旧库文件里的数据）。
    await seedLegacyRegexTables(conn);
    assert.equal(await readUserVersion(conn), 10);

    await bootstrapNovelMaster(conn);

    assert.deepEqual(await listRegexTables(conn), [], "再次 boot 应再次清理");
    assert.equal(await readUserVersion(conn), SCHEMA_BOOT_VERSION);

    await conn.close();
  });
});
