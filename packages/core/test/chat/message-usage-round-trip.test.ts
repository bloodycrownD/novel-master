/**
 * T-S1（→ Step 1-3）：chat_message 三列 usage 持久化 round-trip。
 *
 * - 新建库 `chat_message` 有 prompt_tokens / completion_tokens / total_tokens 三列；
 * - INSERT assistant message 带 usage 后 SELECT 能读回；
 * - 不带 usage / 三列全 NULL 的老消息不展开 usage 字段（兼容路径）。
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
