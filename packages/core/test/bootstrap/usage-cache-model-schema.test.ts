/**
 * T-S1（→ Step 1）：chat_message 新增 cache/模型列 + 索引 + 版本 bump。
 *
 * - 新库直建：chat_message 含 cache_read_tokens / cache_creation_tokens /
 *   model_name 三列，且 idx_chat_message_created_at 索引存在；
 * - 老库（user_version=7）升级：走 bootstrap 慢路径后三列由 ALIGN 补齐、
 *   索引由幂等 DDL 建出，user_version 写为 8（SCHEMA_BOOT_VERSION 生效），
 *   存量行数据保留。
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
import { execLegacyV7ChatMessageDdl } from "./helpers/legacy-db-fixtures.js";

async function openInMemoryConnection(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  return await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

async function tableColumnNames(
  conn: TdbcConnection,
  table: string,
): Promise<Set<string>> {
  const rows = await conn.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${table}')`,
  );
  return new Set(rows.map((row) => row.name));
}

async function indexExists(
  conn: TdbcConnection,
  indexName: string,
): Promise<boolean> {
  const rows = await conn.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = '${indexName}'`,
  );
  return rows.length > 0;
}

async function readUserVersion(conn: TdbcConnection): Promise<number> {
  const rows = await conn.query<{ user_version: number }>(
    "PRAGMA user_version",
  );
  return Number(rows[0]?.user_version ?? 0);
}

function assertNewColumns(columns: Set<string>): void {
  assert.ok(columns.has("cache_read_tokens"), "应有 cache_read_tokens 列");
  assert.ok(
    columns.has("cache_creation_tokens"),
    "应有 cache_creation_tokens 列",
  );
  assert.ok(columns.has("model_name"), "应有 model_name 列");
}

describe("chat_message cache/模型列 schema（T-S1）", () => {
  it("新库直建：bootstrap 后含三新列与 created_at 索引", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);

      assertNewColumns(await tableColumnNames(conn, "chat_message"));
      assert.equal(
        await indexExists(conn, "idx_chat_message_created_at"),
        true,
        "应存在 idx_chat_message_created_at 索引",
      );
      assert.equal(await readUserVersion(conn), 8);
    } finally {
      await conn.close();
    }
  });

  it("老库（user_version=7）升级：ALIGN 补三列、索引建出、版本写 8、行数据保留", async () => {
    const conn = await openInMemoryConnection();
    try {
      // v7 形态：chat_message 已有 hidden 与 usage 三列，但无本轮新增三列。
      await execLegacyV7ChatMessageDdl(conn);
      const now = 1_700_000_000_000;
      await conn.execute(
        `INSERT INTO chat_message (
           id, session_id, seq, role, content_json, provider, raw_json,
           created_at_ms, hidden, prompt_tokens, completion_tokens, total_tokens
         ) VALUES (
           'msg-v7', 'sess-v7', 1, 'assistant',
           '{"blocks":[{"type":"text","text":"hi"}]}', 'openai', '{"usage":{}}',
           ${now}, 0, 12, 34, 46
         )`,
      );
      await conn.execute("PRAGMA user_version = 7");

      await bootstrapNovelMaster(conn);

      assertNewColumns(await tableColumnNames(conn, "chat_message"));
      assert.equal(
        await indexExists(conn, "idx_chat_message_created_at"),
        true,
        "老库升级后应建出 idx_chat_message_created_at 索引",
      );
      assert.equal(
        await readUserVersion(conn),
        8,
        "bootstrap 后 user_version 应写为 SCHEMA_BOOT_VERSION(8)",
      );

      const rows = await conn.query<{
        prompt_tokens: number;
        cache_read_tokens: number | null;
        model_name: string | null;
      }>(
        "SELECT prompt_tokens, cache_read_tokens, model_name FROM chat_message WHERE id = 'msg-v7'",
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.prompt_tokens, 12, "存量行数据应保留");
      assert.equal(rows[0]!.cache_read_tokens, null, "新列默认 NULL");
      assert.equal(rows[0]!.model_name, null, "新列默认 NULL");

      // 二次 bootstrap 走快路径（user_version 已达 8），幂等无错。
      await bootstrapNovelMaster(conn);
      assertNewColumns(await tableColumnNames(conn, "chat_message"));
    } finally {
      await conn.close();
    }
  });
});
