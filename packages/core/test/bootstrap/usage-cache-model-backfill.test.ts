/**
 * usage-cache-model-backfill-v1 migration 行为测试（T-S4）。
 *
 * 直接调用 `usageCacheModelBackfillV1Up`，覆盖：
 *  1. OpenAI / Gemini / Anthropic 非流式 raw → 提取 cache 两列 + 模型名 + 协议；
 *  2. Anthropic 流式残缺 raw（缺 usage 输入侧）→ 只写协议，其余留 NULL；
 *  3. `{streamed:true,...}` 占位 / 判不出协议 → 整行跳过；
 *  4. 不重写 prompt_tokens（spec 决策 1）；
 *  5. 二次执行零改动（幂等：行快照不变 + 第二趟零 UPDATE，登记表尾部校验）；
 *  6. 分批边界（>256 行跨批全部回填）；
 *  7. 已填 provider / cache 的行不被覆盖，但 model_name 仍能补齐。
 *
 * @module test/bootstrap/usage-cache-model-backfill.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NOVEL_MASTER_SCHEMA_STATEMENTS,
  open,
  type TdbcConnection,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import {
  USAGE_CACHE_MODEL_BACKFILL_V1_ID,
  usageCacheModelBackfillV1Up,
} from "../../src/bootstrap/schema-migrations/usage-cache-model-backfill-v1.js";
import { SCHEMA_MIGRATIONS } from "../../src/bootstrap/schema-migrations/index.js";
import {
  CountingTdbcConnection,
  SqlCounter,
} from "../helpers/sql-counting-connection.js";

const NOW_MS = 1_700_000_000_000;

/** 打开内存库并跑全量 DDL，得到具备 chat_message（含三新列）的环境。 */
async function openMemoryConn(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  const conn = await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
  for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
    await conn.execute(sql);
  }
  return conn;
}

type SeedOptions = {
  provider?: string | null;
  cacheReadTokens?: number | null;
  cacheCreationTokens?: number | null;
  promptTokens?: number | null;
};

/** 写一条 chat_message 种子行；rawJson 为 null 时表示 NULL。 */
async function seedMessage(
  conn: TdbcConnection,
  id: string,
  rawJson: string | null,
  opts: SeedOptions = {}
): Promise<void> {
  await conn.execute(
    `INSERT INTO chat_message (
       id, session_id, seq, role, content_json, provider, raw_json,
       created_at_ms, prompt_tokens, cache_read_tokens, cache_creation_tokens
     ) VALUES (?, ?, 1, 'assistant', '{}', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      `sess-${id}`,
      opts.provider ?? null,
      rawJson,
      NOW_MS,
      opts.promptTokens ?? null,
      opts.cacheReadTokens ?? null,
      opts.cacheCreationTokens ?? null,
    ]
  );
}

type MessageRow = {
  id: string;
  provider: string | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  model_name: string | null;
  prompt_tokens: number | null;
};

async function readMessage(
  conn: TdbcConnection,
  id: string
): Promise<MessageRow | undefined> {
  const rows = await conn.query<MessageRow>(
    `SELECT id, provider, cache_read_tokens, cache_creation_tokens,
            model_name, prompt_tokens
     FROM chat_message WHERE id = ?`,
    [id]
  );
  return rows[0];
}

async function readAllMessages(conn: TdbcConnection): Promise<MessageRow[]> {
  return await conn.query<MessageRow>(
    `SELECT id, provider, cache_read_tokens, cache_creation_tokens,
            model_name, prompt_tokens
     FROM chat_message ORDER BY id`
  );
}

const OPENAI_RAW = JSON.stringify({
  model: "gpt-4o",
  usage: {
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
    prompt_tokens_details: { cached_tokens: 64 },
  },
});

const GEMINI_RAW = JSON.stringify({
  modelVersion: "gemini-2.5-pro",
  usageMetadata: {
    promptTokenCount: 10,
    candidatesTokenCount: 5,
    totalTokenCount: 15,
    cachedContentTokenCount: 7,
  },
});

const ANTHROPIC_RAW = JSON.stringify({
  type: "message",
  model: "claude-sonnet-4",
  usage: {
    input_tokens: 50,
    output_tokens: 10,
    cache_read_input_tokens: 32,
    cache_creation_input_tokens: 8,
  },
});

describe("usage-cache-model-backfill-v1 migration（T-S4）", () => {
  it("登记表：migration 位于 SCHEMA_MIGRATIONS 尾部", () => {
    assert.equal(
      SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1]?.id,
      USAGE_CACHE_MODEL_BACKFILL_V1_ID
    );
  });

  it("OpenAI 非流式 raw：提取协议 + 模型 + cache_read，不重写 prompt_tokens", async () => {
    const conn = await openMemoryConn();
    try {
      await seedMessage(conn, "msg-openai", OPENAI_RAW, { promptTokens: 12 });

      await usageCacheModelBackfillV1Up(conn);

      const row = await readMessage(conn, "msg-openai");
      assert.equal(row?.provider, "openai");
      assert.equal(row?.model_name, "gpt-4o");
      assert.equal(row?.cache_read_tokens, 64);
      assert.equal(row?.cache_creation_tokens, null);
      // spec 决策 1：不重写 prompt_tokens（raw 里是 100，库里保留 12）。
      assert.equal(row?.prompt_tokens, 12);
    } finally {
      await conn.close();
    }
  });

  it("Gemini 非流式 raw：提取协议 + modelVersion + cachedContentTokenCount", async () => {
    const conn = await openMemoryConn();
    try {
      await seedMessage(conn, "msg-gemini", GEMINI_RAW);

      await usageCacheModelBackfillV1Up(conn);

      const row = await readMessage(conn, "msg-gemini");
      assert.equal(row?.provider, "gemini");
      assert.equal(row?.model_name, "gemini-2.5-pro");
      assert.equal(row?.cache_read_tokens, 7);
      assert.equal(row?.cache_creation_tokens, null);
    } finally {
      await conn.close();
    }
  });

  it("Anthropic 非流式 raw（合并形态顶层 usage）：提取协议 + 模型 + cache 两列", async () => {
    const conn = await openMemoryConn();
    try {
      await seedMessage(conn, "msg-anthropic", ANTHROPIC_RAW);

      await usageCacheModelBackfillV1Up(conn);

      const row = await readMessage(conn, "msg-anthropic");
      assert.equal(row?.provider, "anthropic");
      assert.equal(row?.model_name, "claude-sonnet-4");
      assert.equal(row?.cache_read_tokens, 32);
      assert.equal(row?.cache_creation_tokens, 8);
    } finally {
      await conn.close();
    }
  });

  it("Anthropic message_start 嵌套形态：model/usage 嵌在 message 下也能提取", async () => {
    const conn = await openMemoryConn();
    try {
      await seedMessage(
        conn,
        "msg-anthropic-start",
        JSON.stringify({
          type: "message_start",
          message: {
            model: "claude-opus-4",
            usage: { input_tokens: 9, cache_read_input_tokens: 4 },
          },
        })
      );

      await usageCacheModelBackfillV1Up(conn);

      const row = await readMessage(conn, "msg-anthropic-start");
      assert.equal(row?.provider, "anthropic");
      assert.equal(row?.model_name, "claude-opus-4");
      assert.equal(row?.cache_read_tokens, 4);
    } finally {
      await conn.close();
    }
  });

  it("Anthropic 流式残缺 raw（delta 形态只有输出侧）：只写协议，其余留 NULL", async () => {
    const conn = await openMemoryConn();
    try {
      await seedMessage(
        conn,
        "msg-anthropic-delta",
        JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 7 },
        })
      );

      await usageCacheModelBackfillV1Up(conn);

      const row = await readMessage(conn, "msg-anthropic-delta");
      assert.equal(row?.provider, "anthropic");
      assert.equal(row?.model_name, null);
      assert.equal(row?.cache_read_tokens, null);
      assert.equal(row?.cache_creation_tokens, null);
    } finally {
      await conn.close();
    }
  });

  it("{streamed:true} 占位与判不出协议的 raw：整行跳过（provider 也保持 NULL）", async () => {
    const conn = await openMemoryConn();
    try {
      await seedMessage(
        conn,
        "msg-placeholder",
        JSON.stringify({ streamed: true, aborted: true })
      );
      await seedMessage(conn, "msg-unknown", JSON.stringify({ foo: "bar" }));
      await seedMessage(conn, "msg-broken", "{not json");

      await usageCacheModelBackfillV1Up(conn);

      for (const id of ["msg-placeholder", "msg-unknown", "msg-broken"]) {
        const row = await readMessage(conn, id);
        assert.equal(row?.provider, null, `${id} provider 应保持 NULL`);
        assert.equal(row?.model_name, null, `${id} model_name 应保持 NULL`);
        assert.equal(
          row?.cache_read_tokens,
          null,
          `${id} cache_read_tokens 应保持 NULL`
        );
      }
    } finally {
      await conn.close();
    }
  });

  it("B-1: raw 里显式 0 的 cache 字段 → 回填 0 而非跳过（与 usage-parser 口径一致）", async () => {
    const conn = await openMemoryConn();
    try {
      await seedMessage(
        conn,
        "msg-openai-zero",
        JSON.stringify({
          model: "gpt-4o",
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_tokens_details: { cached_tokens: 0 },
          },
        })
      );
      await seedMessage(
        conn,
        "msg-anthropic-zero",
        JSON.stringify({
          type: "message",
          model: "claude-sonnet-4",
          usage: {
            input_tokens: 50,
            output_tokens: 10,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        })
      );

      await usageCacheModelBackfillV1Up(conn);

      const openaiRow = await readMessage(conn, "msg-openai-zero");
      assert.equal(openaiRow?.provider, "openai");
      assert.equal(openaiRow?.cache_read_tokens, 0);
      const anthropicRow = await readMessage(conn, "msg-anthropic-zero");
      assert.equal(anthropicRow?.provider, "anthropic");
      assert.equal(anthropicRow?.cache_read_tokens, 0);
      assert.equal(anthropicRow?.cache_creation_tokens, 0);
    } finally {
      await conn.close();
    }
  });

  it("G-1 不变量：回填后凡 cache 列非 NULL 的行 provider 必非 NULL", async () => {
    const conn = await openMemoryConn();
    try {
      await seedMessage(conn, "msg-openai", OPENAI_RAW, { promptTokens: 12 });
      await seedMessage(conn, "msg-gemini", GEMINI_RAW);
      await seedMessage(conn, "msg-anthropic", ANTHROPIC_RAW);
      await seedMessage(
        conn,
        "msg-placeholder",
        JSON.stringify({ streamed: true, aborted: true })
      );

      await usageCacheModelBackfillV1Up(conn);

      // spec 关键决策 1 声明的不变量：cache 列能提出值 ⟸ 判出了协议 ⟸ provider 已写或被补。
      const violated = await conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM chat_message
         WHERE (cache_read_tokens IS NOT NULL OR cache_creation_tokens IS NOT NULL)
           AND provider IS NULL`
      );
      assert.equal(
        violated[0]?.n,
        0,
        "cache 列非 NULL 的行 provider 不能是 NULL"
      );
      // 对照：确有 cache 非 NULL 的行存在（防断言空转）。
      const cached = await conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM chat_message
         WHERE cache_read_tokens IS NOT NULL OR cache_creation_tokens IS NOT NULL`
      );
      assert.equal((cached[0]?.n ?? 0) > 0, true);
    } finally {
      await conn.close();
    }
  });

  it("已填 provider / cache 的行不被覆盖，但 model_name 仍补齐", async () => {
    const conn = await openMemoryConn();
    try {
      // provider 已有自定义值：不覆盖，但模型名与 cache（当前 NULL）照常回填。
      await seedMessage(conn, "msg-kept-provider", OPENAI_RAW, {
        provider: "openai-compatible",
      });
      // cache 已填：保持原值，模型名补齐（「cache 已填但 model NULL」场景）。
      await seedMessage(conn, "msg-kept-cache", OPENAI_RAW, {
        cacheReadTokens: 999,
      });

      await usageCacheModelBackfillV1Up(conn);

      const keptProvider = await readMessage(conn, "msg-kept-provider");
      assert.equal(keptProvider?.provider, "openai-compatible");
      assert.equal(keptProvider?.model_name, "gpt-4o");
      assert.equal(keptProvider?.cache_read_tokens, 64);

      const keptCache = await readMessage(conn, "msg-kept-cache");
      assert.equal(keptCache?.cache_read_tokens, 999);
      assert.equal(keptCache?.model_name, "gpt-4o");
    } finally {
      await conn.close();
    }
  });

  it("幂等：二次执行行快照不变且零 UPDATE（条件收敛）", async () => {
    const conn = await openMemoryConn();
    try {
      await seedMessage(conn, "msg-openai", OPENAI_RAW, { promptTokens: 12 });
      await seedMessage(conn, "msg-gemini", GEMINI_RAW);
      await seedMessage(conn, "msg-anthropic", ANTHROPIC_RAW);
      await seedMessage(
        conn,
        "msg-anthropic-delta",
        JSON.stringify({
          type: "message_delta",
          usage: { output_tokens: 7 },
        })
      );
      await seedMessage(
        conn,
        "msg-placeholder",
        JSON.stringify({ streamed: true, aborted: true })
      );

      await usageCacheModelBackfillV1Up(conn);
      const afterFirst = await readAllMessages(conn);

      // 第二趟包计数连接：除 SELECT 分页外不应发出任何 UPDATE。
      const counter = new SqlCounter();
      const counting = new CountingTdbcConnection(conn, counter);
      await usageCacheModelBackfillV1Up(counting);
      assert.equal(
        counter.countBySubstring("UPDATE chat_message"),
        0,
        "二次执行不应发出任何 UPDATE chat_message"
      );

      const afterSecond = await readAllMessages(conn);
      assert.deepEqual(afterFirst, afterSecond);
    } finally {
      await conn.close();
    }
  });

  it("分批边界：260 行（>256）跨批全部回填正确", async () => {
    const conn = await openMemoryConn();
    try {
      const total = 260; // batch 256 → 两批。
      const raw = JSON.stringify({
        model: "gpt-4o-mini",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
          prompt_tokens_details: { cached_tokens: 3 },
        },
      });
      for (let i = 0; i < total; i++) {
        // id 定长零填充，保证 ORDER BY id 的字典序与插入序一致，便于首尾断言。
        const id = `bulk-${String(i).padStart(4, "0")}`;
        await seedMessage(conn, id, raw);
      }

      await usageCacheModelBackfillV1Up(conn);

      const rows = await conn.query<{
        model_name: string | null;
        provider: string | null;
        cache_read_tokens: number | null;
      }>(`SELECT model_name, provider, cache_read_tokens FROM chat_message`);
      assert.equal(rows.length, total);
      for (const row of rows) {
        assert.equal(row.provider, "openai");
        assert.equal(row.model_name, "gpt-4o-mini");
        assert.equal(row.cache_read_tokens, 3);
      }
    } finally {
      await conn.close();
    }
  });
});
