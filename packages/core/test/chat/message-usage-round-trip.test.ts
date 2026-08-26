/**
 * T-S1（→ Step 1-3）：chat_message 三列 usage 持久化 round-trip。
 *
 * - 新建库 `chat_message` 有 prompt_tokens / completion_tokens / total_tokens 三列；
 * - INSERT assistant message 带 usage 后 SELECT 能读回；
 * - 不带 usage / 三列全 NULL 的老消息不展开 usage 字段（兼容路径）。
 *
 * T-S3（→ Step 3）：cache 两列 + model_name 读写 round-trip。
 *
 * - assistant 消息带 provider + modelName + cache 字段 → 读回保持；
 * - cache 两列全 NULL → usage 不含 cacheReadTokens/cacheCreationTokens；
 * - 仅 cache 有值（基础三列 NULL）→ usage 只含 cache 字段。
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("message usage round-trip (T-S1)", () => {
  it("新建库 chat_message 含三个 usage 列", async () => {
    const ctx = getNovelMasterTestContext();
    const columns = await ctx.conn.query<{ name: string }>(
      `SELECT name FROM pragma_table_info('chat_message')`,
    );
    const names = columns.map((c) => c.name);
    assert.equal(names.includes("prompt_tokens"), true);
    assert.equal(names.includes("completion_tokens"), true);
    assert.equal(names.includes("total_tokens"), true);
  });

  it("新建库 chat_message 含 cache 两列与 model_name 列（T-S3）", async () => {
    const ctx = getNovelMasterTestContext();
    const columns = await ctx.conn.query<{ name: string }>(
      `SELECT name FROM pragma_table_info('chat_message')`,
    );
    const names = columns.map((c) => c.name);
    assert.equal(names.includes("cache_read_tokens"), true);
    assert.equal(names.includes("cache_creation_tokens"), true);
    assert.equal(names.includes("model_name"), true);
  });

  it("INSERT assistant message 带 usage → SELECT 读回三个字段", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "usage-round-trip");

    const appended = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("hello"),
      {
        usage: {
          promptTokens: 12,
          completionTokens: 34,
          totalTokens: 46,
        },
      },
    );
    assert.deepEqual(appended.usage, {
      promptTokens: 12,
      completionTokens: 34,
      totalTokens: 46,
    });

    // listBySession 读回
    const listed = await ctx.messages.listBySession(session.id);
    const reloaded = listed.find((m) => m.id === appended.id);
    assert.ok(reloaded);
    assert.deepEqual(reloaded!.usage, {
      promptTokens: 12,
      completionTokens: 34,
      totalTokens: 46,
    });

    // get 单条读回
    const byId = await ctx.messages.get(appended.id);
    assert.deepEqual(byId.usage, {
      promptTokens: 12,
      completionTokens: 34,
      totalTokens: 46,
    });
  });

  it("INSERT message 不带 usage → SELECT usage 为 undefined", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "usage-undefined");

    const appended = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("hi"),
    );
    assert.equal(appended.usage, undefined);

    const listed = await ctx.messages.listBySession(session.id);
    const reloaded = listed.find((m) => m.id === appended.id);
    assert.ok(reloaded);
    assert.equal(reloaded!.usage, undefined);
  });

  it("repo 直接 insert 三列全 NULL 的老消息 → usage 为 undefined（不展开空对象）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "legacy-null-usage");

    const repo = new SqliteMessageRepository(ctx.conn);
    // 模拟老消息：构造一个不带 usage 的 ChatMessage（三列会绑成 NULL）
    const legacy: ChatMessage = {
      id: randomUUID(),
      sessionId: session.id,
      seq: 1,
      role: "assistant",
      content: textBlocks("legacy"),
      provider: null,
      raw: null,
      createdAtMs: Date.now(),
      hidden: false,
    };
    await repo.insert(legacy);

    const read = await repo.findById(legacy.id);
    assert.ok(read);
    // 关键：三列全 NULL → 不展开成空对象，usage 字段根本不在
    assert.equal(read!.usage, undefined);
    assert.equal("usage" in read!, false);
  });

  it("usage 部分字段缺失时仍读回已有字段", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "usage-partial");

    const appended = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("partial"),
      {
        usage: { promptTokens: 99 },
      },
    );
    assert.deepEqual(appended.usage, { promptTokens: 99 });

    const byId = await ctx.messages.get(appended.id);
    assert.deepEqual(byId.usage, { promptTokens: 99 });
  });
});

describe("message timing fields round-trip (T-MU1)", () => {
  it("新字段随 usage 往返保真（token + 耗时齐全）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "timing-round-trip");

    const usage = {
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      firstTokenMs: 320,
      durationMs: 2100,
    };
    const appended = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("timed"),
      { usage },
    );
    assert.deepEqual(appended.usage, usage);

    const byId = await ctx.messages.get(appended.id);
    assert.deepEqual(byId.usage, usage);
  });

  it("仅 token 无耗时 → usage 不含 firstTokenMs/durationMs（老数据形态）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "token-only");

    const appended = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("token-only"),
      {
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
    );
    const byId = await ctx.messages.get(appended.id);
    assert.deepEqual(byId.usage, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    assert.equal("firstTokenMs" in byId.usage!, false);
    assert.equal("durationMs" in byId.usage!, false);
  });

  it("仅耗时无 token → usage 只含耗时字段（token 统计不受影响）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "timing-only");

    const repo = new SqliteMessageRepository(ctx.conn);
    const message: ChatMessage = {
      id: randomUUID(),
      sessionId: session.id,
      seq: 1,
      role: "assistant",
      content: textBlocks("timing-only"),
      provider: "openai",
      modelName: "gpt-5.2",
      raw: null,
      createdAtMs: Date.now(),
      hidden: false,
      usage: { firstTokenMs: 500, durationMs: 500 },
    };
    await repo.insert(message);

    const read = await repo.findById(message.id);
    assert.ok(read);
    assert.deepEqual(read!.usage, { firstTokenMs: 500, durationMs: 500 });
  });

  it("新建库 chat_message 含 first_token_ms / duration_ms 两列", async () => {
    const ctx = getNovelMasterTestContext();
    const columns = await ctx.conn.query<{ name: string }>(
      `SELECT name FROM pragma_table_info('chat_message')`,
    );
    const names = columns.map((c) => c.name);
    assert.equal(names.includes("first_token_ms"), true);
    assert.equal(names.includes("duration_ms"), true);
  });
});

describe("message cache/model_name round-trip (T-S3)", () => {
  it("assistant 带 provider + modelName + cache 字段 → 读回保持", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "cache-round-trip");

    const usage = {
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      cacheReadTokens: 2048,
      cacheCreationTokens: 512,
    };
    const appended = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("cached"),
      {
        provider: "anthropic",
        modelName: "claude-sonnet-4-5",
        usage,
      },
    );
    assert.equal(appended.provider, "anthropic");
    assert.equal(appended.modelName, "claude-sonnet-4-5");
    assert.deepEqual(appended.usage, usage);

    const byId = await ctx.messages.get(appended.id);
    assert.equal(byId.provider, "anthropic");
    assert.equal(byId.modelName, "claude-sonnet-4-5");
    assert.deepEqual(byId.usage, usage);

    const listed = await ctx.messages.listBySession(session.id);
    const reloaded = listed.find((m) => m.id === appended.id);
    assert.ok(reloaded);
    assert.equal(reloaded!.provider, "anthropic");
    assert.equal(reloaded!.modelName, "claude-sonnet-4-5");
    assert.deepEqual(reloaded!.usage, usage);
  });

  it("不传 modelName → 落库 NULL，读回 null（老消息兼容）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "model-name-null");

    const appended = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("no-model"),
    );
    assert.equal(appended.modelName, null);

    const byId = await ctx.messages.get(appended.id);
    assert.equal(byId.modelName, null);
  });

  it("cache 两列全 NULL → usage 不含 cache 字段（老消息兼容）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "cache-null");

    const appended = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("no-cache"),
      {
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
    );
    const byId = await ctx.messages.get(appended.id);
    assert.deepEqual(byId.usage, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    assert.equal("cacheReadTokens" in byId.usage!, false);
    assert.equal("cacheCreationTokens" in byId.usage!, false);
  });

  it("G-1 不变量（新消息来源）：带 cache 的消息落库后 provider 必非 NULL", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "invariant-new-msg");

    // append 带 provider + cache 的正常路径消息。
    await ctx.messages.append(session.id, "assistant", textBlocks("inv"), {
      provider: "anthropic",
      modelName: "claude-sonnet-4-5",
      usage: {
        promptTokens: 10,
        totalTokens: 10,
        cacheReadTokens: 4,
        cacheCreationTokens: 2,
      },
    });
    // repo 直接 insert 带 cache 的消息（同样走 provider 列写入）。
    const repo = new SqliteMessageRepository(ctx.conn);
    await repo.insert({
      id: randomUUID(),
      sessionId: session.id,
      seq: 2,
      role: "assistant",
      content: textBlocks("inv-repo"),
      provider: "openai",
      modelName: "gpt-5.2",
      raw: null,
      createdAtMs: Date.now(),
      hidden: false,
      usage: { cacheReadTokens: 3 },
    });

    // spec 关键决策 1：凡 cache 列非 NULL 的行，provider 必非 NULL（新消息由请求侧写入）。
    const violated = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM chat_message
       WHERE (cache_read_tokens IS NOT NULL OR cache_creation_tokens IS NOT NULL)
         AND provider IS NULL
         AND session_id = ?`,
      [session.id],
    );
    assert.equal(violated[0]?.n, 0, "cache 列非 NULL 的行 provider 不能是 NULL");
  });

  it("G-1 现状快照：append 带 usage（含 cache）不带 provider → provider 落 NULL、cache 照写", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "no-provider-snapshot");

    const appended = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("no-provider"),
      {
        usage: {
          promptTokens: 10,
          totalTokens: 10,
          cacheReadTokens: 5,
        },
      },
    );

    // 锁定现状：append 不强制「cache 非 NULL ⟹ provider 非 NULL」不变量，
    // 该不变量由请求侧（正常路径必写 provider）与回填（判出协议才提 cache）保证；
    // 此用例防止无意识漂移（如 append 开始拒绝或静默丢 cache）。
    assert.equal(appended.provider, null);
    assert.equal(appended.usage?.cacheReadTokens, 5);

    const row = await ctx.conn.query<{
      provider: string | null;
      cache_read_tokens: number | null;
    }>(
      `SELECT provider, cache_read_tokens FROM chat_message WHERE id = ?`,
      [appended.id],
    );
    assert.equal(row[0]?.provider, null);
    assert.equal(row[0]?.cache_read_tokens, 5);
  });

  it("仅 cache 有值（基础三列 NULL）→ usage 只含 cache 字段", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "cache-only");

    const repo = new SqliteMessageRepository(ctx.conn);
    const message: ChatMessage = {
      id: randomUUID(),
      sessionId: session.id,
      seq: 1,
      role: "assistant",
      content: textBlocks("cache-only"),
      provider: "openai",
      modelName: "gpt-5.2",
      raw: null,
      createdAtMs: Date.now(),
      hidden: false,
      usage: { cacheReadTokens: 33 },
    };
    await repo.insert(message);

    const read = await repo.findById(message.id);
    assert.ok(read);
    assert.deepEqual(read!.usage, { cacheReadTokens: 33 });
    assert.equal(read!.provider, "openai");
    assert.equal(read!.modelName, "gpt-5.2");
  });

  it("repo 直接 insert 五列全 NULL 的老消息 → usage 为 undefined（不展开空对象）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "legacy-null-cache");

    const repo = new SqliteMessageRepository(ctx.conn);
    const legacy: ChatMessage = {
      id: randomUUID(),
      sessionId: session.id,
      seq: 1,
      role: "assistant",
      content: textBlocks("legacy"),
      provider: null,
      raw: null,
      createdAtMs: Date.now(),
      hidden: false,
    };
    await repo.insert(legacy);

    const read = await repo.findById(legacy.id);
    assert.ok(read);
    assert.equal(read!.usage, undefined);
    assert.equal("usage" in read!, false);
    assert.equal(read!.modelName, null);
  });
});
