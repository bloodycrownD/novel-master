/**
 * 消息正文压缩存储 schema 用例（T-C10）：legacy 库 align 后两列就位、
 * SCHEMA_BOOT_VERSION 快/慢路径各自生效，外加「BOOT 写小 → 快路径
 * 不补列」负面教材（「加列必须 bump」纪律的反面演示）。
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
import type { Row } from "../../src/infra/tdbc/types.js";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";

/**
 * 压缩两列进入合同的 BOOT 版本（v17 bump 引入，见
 * novel-master-bootstrap.ts 头注释 v17 条目）：「加列必须 bump」纪律的锚点。
 * 用例对 bootstrap 后库的实际 user_version 断言 ≥ 此值——若有人把
 * SCHEMA_BOOT_VERSION 静默回退（忘 bump / 回退代码），快路径将永久跳过
 * 补列（下方负面教材用例演示的正是该事故形态），锚点断言先红。
 */
const COMPRESSION_COLUMNS_BOOT_VERSION = 17;

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

/**
 * DDL 探针连接：包装真实连接，记录流经 execute/batch 的每条 SQL，
 * 供快路径用例断言「第二次 bootstrap 期间未下发任何 DDL」。
 * bootstrap 的 DDL 全部跑在事务里，因此事务回调拿到的 tx 也要过探针。
 */
class DdlProbeConnection implements TdbcConnection {
  readonly executedSql: string[] = [];

  constructor(private readonly inner: TdbcConnection) {}

  async execute(sql: string, parameters?: readonly unknown[]) {
    this.executedSql.push(sql);
    return this.inner.execute(sql, parameters);
  }

  async query<T extends Row>(
    sql: string,
    parameters?: readonly unknown[]
  ): Promise<T[]> {
    return this.inner.query<T>(sql, parameters);
  }

  async batch(
    sql: string,
    parametersList: readonly (readonly unknown[])[]
  ): Promise<ReturnType<TdbcConnection["batch"]>> {
    this.executedSql.push(sql);
    return this.inner.batch(sql, parametersList);
  }

  async transaction<T>(fn: (tx: TdbcConnection) => Promise<T>): Promise<T> {
    // 事务体内的 tx 包装进探针后才交给原回调——ALTER/CREATE 才不会漏记。
    return this.inner.transaction((tx) => fn(this.wrapTx(tx)));
  }

  async close(): Promise<void> {
    return this.inner.close();
  }

  private wrapTx(tx: TdbcConnection): TdbcConnection {
    const probe = this;
    return {
      execute: async (sql, parameters) => {
        probe.executedSql.push(sql);
        return tx.execute(sql, parameters);
      },
      query: (sql, parameters) => tx.query(sql, parameters),
      batch: async (sql, parametersList) => {
        probe.executedSql.push(sql);
        return tx.batch(sql, parametersList);
      },
      transaction: (fn) => tx.transaction(fn),
      close: () => tx.close(),
    };
  }
}

describe("消息正文压缩存储 schema（T-C10）", () => {
  it("慢路径：SCHEMA_BOOT_VERSION - 1 存量库（缺压缩两列）bootstrap 后补列、版本升到 SCHEMA_BOOT_VERSION，明文行读回正常", async () => {
    const conn = await openInMemoryConnection();
    try {
      const sessionId = randomUUID();
      const legacyMessageId = randomUUID();
      const now = 1_700_000_000_000;
      // 先建当前完整 schema，再裁掉压缩两列、把 user_version 回拨到
      // SCHEMA_BOOT_VERSION - 1（当前落 16），模拟真实上一版存量库（形态
      // 对齐 A12 先例——锁「加列忘 bump」bug 形态）。fixture 版本用常量
      // 表达式跟随 BOOT 演进：将来 v18 再加列时此处自动落 17。
      await bootstrapNovelMaster(conn);
      await conn.execute("ALTER TABLE chat_message DROP COLUMN content_encoding");
      await conn.execute("ALTER TABLE chat_message DROP COLUMN content_blob");
      await conn.execute(`PRAGMA user_version = ${SCHEMA_BOOT_VERSION - 1}`);
      await conn.execute(
        `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms)
         VALUES ('${sessionId}', '${randomUUID()}', 'legacy', ${now}, ${now})`
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
      // 「加列必须 bump」锚点：补列后库的实际版本必须已覆盖压缩两列合同
      // （v17）。把 SCHEMA_BOOT_VERSION 回退到 16 时此断言红——BOOT 不再
      // 覆盖新列语义，真实 v16 存量库将走快路径永不补列。
      assert.ok(
        (versionRows[0]?.user_version ?? 0) >= COMPRESSION_COLUMNS_BOOT_VERSION,
        `补列后 user_version 应 ≥ ${COMPRESSION_COLUMNS_BOOT_VERSION}（压缩两列合同版本；若红说明 SCHEMA_BOOT_VERSION 被回退——加列必须 bump）`
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

      // ALIGN 补列必须带 CHECK 值域（防 align SQL 与 canonical DDL 漂移——
      // 值域放宽/收紧测不出就是这里的缺口）：'gzip' 不在值域内被拒，
      // 'zlib' / 'zlib-b64' 可插入。把 ALIGN 条目的 CHECK 删掉 → rejects 红。
      const checkSeqBase = 10;
      await assert.rejects(() =>
        conn.execute(
          `INSERT INTO chat_message (
             id, session_id, seq, role, content_json,
             content_encoding, content_blob, created_at_ms
           ) VALUES (
             '${randomUUID()}', '${sessionId}', ${checkSeqBase}, 'user', '{}',
             'gzip', NULL, ${now + 10}
           )`
        )
      );
      let seq = checkSeqBase + 1;
      for (const encoding of ["zlib", "zlib-b64"]) {
        await conn.execute(
          `INSERT INTO chat_message (
             id, session_id, seq, role, content_json,
             content_encoding, content_blob, created_at_ms
           ) VALUES (
             '${randomUUID()}', '${sessionId}', ${seq}, 'user', '{}',
             '${encoding}', NULL, ${now + 10 + seq}
           )`
        );
        seq += 1;
      }
    } finally {
      await conn.close();
    }
  });

  it("快路径：连续 bootstrap 幂等，两列就位且第二次 bootstrap 不下发任何 DDL", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);
      // 第二次 bootstrap：user_version 已达 SCHEMA_BOOT_VERSION，走快路径——
      // 用 DDL 探针连接包一层，断言期间未观测到任何 ALTER TABLE / CREATE。
      const probe = new DdlProbeConnection(conn);
      await bootstrapNovelMaster(probe);

      const columns = await tableColumnNames(conn, "chat_message");
      assert.ok(columns.has("content_encoding"));
      assert.ok(columns.has("content_blob"));

      const versionRows = await conn.query<{ user_version: number }>(
        "PRAGMA user_version"
      );
      assert.equal(versionRows[0]?.user_version, SCHEMA_BOOT_VERSION);

      // 探针断言无 DDL：快路径只跑 pending migration / seed / PRAGMA，不得
      // 出现 ALTER TABLE / CREATE TABLE / CREATE INDEX 等任何表结构 DDL。
      // 豁免：schema_migrations 是 migration runner 的记账表，每次
      // bootstrap 都幂等 CREATE IF NOT EXISTS（ensureSchemaMigrationsTable），
      // 与业务表结构无关，不属本断言要抓的「快路径偷偷改结构」。
      const ddlPattern = /\b(ALTER\s+TABLE|CREATE\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i;
      const bookkeepingPattern =
        /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+schema_migrations\b/i;
      const ddlSql = probe.executedSql.filter(
        (sql) => ddlPattern.test(sql) && !bookkeepingPattern.test(sql)
      );
      assert.equal(
        ddlSql.length,
        0,
        `快路径不应下发任何 DDL，探针观测到：${JSON.stringify(ddlSql)}`
      );
    } finally {
      await conn.close();
    }
  });

  it("负面教材：BOOT 写小 → 快路径不补列（「加列必须 bump」纪律的反面）", async () => {
    // 模拟「加列忘 bump 后已经写高版本」的库：先 bootstrap 完整库，再手工
    // DROP 掉两列、把 user_version 顶到 SCHEMA_BOOT_VERSION——再 bootstrap
    // 时版本已达标走快路径，DDL/ALIGN 全部跳过，两列永远不补。
    // 这就是 v9/v10 真机事故（no such column）的形态：若要修复此形态的库，
    // 唯一正解是 bump SCHEMA_BOOT_VERSION 让它重新走慢路径。
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);
      await conn.execute("ALTER TABLE chat_message DROP COLUMN content_encoding");
      await conn.execute("ALTER TABLE chat_message DROP COLUMN content_blob");
      await conn.execute(`PRAGMA user_version = ${SCHEMA_BOOT_VERSION}`);

      await bootstrapNovelMaster(conn);

      const columns = await tableColumnNames(conn, "chat_message");
      assert.ok(
        !columns.has("content_encoding"),
        "快路径不应补 content_encoding（事故形态演示，非期望行为）"
      );
      assert.ok(
        !columns.has("content_blob"),
        "快路径不应补 content_blob（事故形态演示，非期望行为）"
      );

      const versionRows = await conn.query<{ user_version: number }>(
        "PRAGMA user_version"
      );
      assert.equal(versionRows[0]?.user_version, SCHEMA_BOOT_VERSION);

      // 锚点断言（与慢路径用例同款）：当前 BOOT 必须已覆盖压缩两列合同
      // （v17）。把 SCHEMA_BOOT_VERSION 静默回退到 16 时此处红——真实
      // v16 存量库正是上面演示的形态：快路径永不补列，加列必须 bump。
      assert.ok(
        (versionRows[0]?.user_version ?? 0) >= COMPRESSION_COLUMNS_BOOT_VERSION,
        `负面教材前提：当前 BOOT 应 ≥ ${COMPRESSION_COLUMNS_BOOT_VERSION}（压缩两列合同版本；若红说明 SCHEMA_BOOT_VERSION 被回退——加列必须 bump）`
      );
    } finally {
      await conn.close();
    }
  });
});
