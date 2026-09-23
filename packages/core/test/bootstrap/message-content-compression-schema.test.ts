/**
 * 消息正文压缩存储 schema 用例（T-C10）：legacy 库 align 后两列就位、
 * SCHEMA_BOOT_VERSION 快/慢路径各自生效。
 *
 * @module test/bootstrap/message-content-compression-schema
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  bootstrapNovelMaster,
  open,
  SCHEMA_BOOT_VERSION,
  type TdbcConnection,
} from "@novel-master/core";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";

async function openInMemoryConnection(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  return await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

async function tableColumnNames(
  conn: TdbcConnection,
  table: string
): Promise<Set<string>> {
  const rows = await conn.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${table}')`
  );
  return new Set(rows.map((row) => row.name));
}

describe("消息正文压缩存储 schema（T-C10）", () => {
  it("慢路径：v15 存量库（缺压缩两列）bootstrap 后补列、版本升到 SCHEMA_BOOT_VERSION，明文行读回正常", async () => {
    const conn = await openInMemoryConnection();
    try {
      const sessionId = randomUUID();
      const legacyMessageId = randomUUID();
      const now = 1_700_000_000_000;
      // 先建当前完整 schema，再裁掉 v16 新增两列、把 user_version 回拨到 15，
      // 模拟真实 v15 存量库（形态对齐 A12 先例——锁「加列忘 bump」bug 形态）。
      await bootstrapNovelMaster(conn);
      await conn.execute("ALTER TABLE chat_message DROP COLUMN content_encoding");
      await conn.execute("ALTER TABLE chat_message DROP COLUMN content_blob");
      await conn.execute("PRAGMA user_version = 15");
      await conn.execute(
        `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms)
         VALUES ('${sessionId}', '${randomUUID()}', 'v15-legacy', ${now}, ${now})`
      );
      await conn.execute(
        `INSERT INTO chat_message (
           id, session_id, seq, role, content_json, created_at_ms
         ) VALUES (
           '${legacyMessageId}', '${sessionId}', 1, 'user',
           '{"blocks":[{"type":"text","text":"legacy-plaintext"}]}', ${now}
         )`
      );

      await bootstrapNovelMaster(conn);

      const columns = await tableColumnNames(conn, "chat_message");
      assert.ok(
        columns.has("content_encoding"),
        "content_encoding 应被 ALIGN 补列"
      );
      assert.ok(columns.has("content_blob"), "content_blob 应被 ALIGN 补列");

      const versionRows = await conn.query<{ user_version: number }>(
        "PRAGMA user_version"
      );
      assert.equal(
        versionRows[0]?.user_version,
        SCHEMA_BOOT_VERSION,
        "user_version 应升到 SCHEMA_BOOT_VERSION"
      );

      // 补列后 legacy 明文行（两列皆 NULL）读回正常——双形态地基。
      const repo = new SqliteMessageRepository(conn);
      const read = await repo.findById(legacyMessageId);
      assert.ok(read);
      assert.deepEqual(read!.content, textBlocks("legacy-plaintext"));

      // 新写入在新列就位后可正常 INSERT/SELECT（压缩形态断言由
      // T-C1 往返用例覆盖，此处只锁 schema 语义）。
      const message = {
        id: randomUUID(),
        sessionId,
        seq: 2,
        role: "user" as const,
        content: textBlocks("compressed-new"),
        provider: null,
        raw: null,
        createdAtMs: now + 1,
        hidden: false,
      };
      await repo.insert(message);
      const readNew = await repo.findById(message.id);
      assert.ok(readNew);
      assert.deepEqual(readNew!.content, textBlocks("compressed-new"));
    } finally {
      await conn.close();
    }
  });

  it("快路径：连续 bootstrap 幂等，两列就位不重复补列不报错", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);
      // 第二次 bootstrap：user_version 已达 SCHEMA_BOOT_VERSION，走快路径。
      await bootstrapNovelMaster(conn);

      const columns = await tableColumnNames(conn, "chat_message");
      assert.ok(columns.has("content_encoding"));
      assert.ok(columns.has("content_blob"));

      const versionRows = await conn.query<{ user_version: number }>(
        "PRAGMA user_version"
      );
      assert.equal(versionRows[0]?.user_version, SCHEMA_BOOT_VERSION);
    } finally {
      await conn.close();
    }
  });
});
