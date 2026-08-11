/**
 * runCompaction 执行器测试（对应 SPEC T-CC1~T-CC4）。
 *
 * T-CC1 覆盖 v3 文档读迁移到 v4（store 层）；
 * T-CC2/T-CC3 用真实 DB fixture 验证 runCompaction 端到端副作用；
 * T-CC4 用抛异常的 messageTranscriptEffects stub 验证降级返回。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "../../src/domain/chat/content/text-blocks.js";
import { ChatAgentSession } from "../../src/service/agent/impl/chat-agent-session.js";
import { runCompaction } from "../../src/service/compaction-conditions/run-compaction.js";
import { createMessageTranscriptEffectsService } from "../../src/service/chat/create-message-transcript-effects.js";
import { createCompactionConditionsStore } from "../../src/service/compaction-conditions/create-compaction-conditions-store.js";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";
import { sessionApiPromptTokenCache } from "../../src/infra/tokenizer/logic/session-api-prompt-token-cache.js";
import type { MessageTranscriptEffectsService } from "../../src/service/chat/message-transcript-effects.port.js";
import type { MessageService } from "../../src/service/chat/message.port.js";
import type { SessionKkvService } from "../../src/service/session-kkv/session-kkv.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const RULE_SNAPSHOT = "rule_snapshot";
const FILE_CACHE = "file_cache";

/** 构造一个一定会抛异常的 effects，用于 T-CC4。 */
function throwingEffects(): MessageTranscriptEffectsService {
  const boom = async (): Promise<never> => {
    throw new Error("boom-from-effects");
  };
  return {
    hideMessagesInRange: boom,
    showMessagesInRange: boom,
    truncateMessagesAfter: boom,
    setMessageFloorAtMessage: boom,
  };
}

async function appendMany(
  messages: MessageService,
  sessionId: string,
  roles: readonly string[],
): Promise<void> {
  const session = new ChatAgentSession(messages, sessionId);
  for (const role of roles) {
    await session.append(role, textBlocks(`${role}-${Math.random()}`));
  }
}

describe("runCompaction", () => {
  it("T-CC1: v3 文档读取时自动迁移到 v4，hideStartDepth 填 6 并写回 KKV", async () => {
    const ctx = getNovelMasterTestContext();
    const kkv = createKkvService(ctx.conn);
    const store = createCompactionConditionsStore(ctx.conn);

    await kkv.set(
      "nm-compaction-conditions",
      "policy",
      JSON.stringify({
        schemaVersion: 3,
        enabled: true,
        tokenRatio: 0.8,
        visibleFloor: 20,
      }),
    );

    const first = await store.getConditions();
    assert.equal(first?.schemaVersion, 4);
    assert.equal(first?.hideStartDepth, 6);

    const raw = await kkv.get("nm-compaction-conditions", "policy");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed.schemaVersion, 4);
    assert.equal(parsed.hideStartDepth, 6);
  });

  it("T-CC2: 正常执行时 hide-message 生效，清 RULE_SNAPSHOT + FILE_CACHE，invalidate token cache", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const sessionRow = await ctx.sessions.create(project.id);
    const sessionId = sessionRow.id;

    // 10 条消息：depth 9..0，hideStartDepth=6 会 hide 掉 depth>=6 的前缀段。
    await appendMany(ctx.messages, sessionId, [
      "user",
      "assistant",
      "user",
      "user",
      "assistant",
      "assistant",
      "assistant",
      "assistant",
      "assistant",
      "assistant",
    ]);

    const effects = createMessageTranscriptEffectsService(ctx.conn);

    // 预置 rule_snapshot / file_cache 数据，验证会被清空。
    await ctx.sessionKkv.set(sessionId, RULE_SNAPSHOT, "canon", "snap");
    await ctx.sessionKkv.set(sessionId, FILE_CACHE, "fc-key", "fc-val");
    // 预置 prompt token cache，验证会被 invalidate。
    sessionApiPromptTokenCache.set(sessionId, {
      promptTokens: 1234,
      updatedAt: Date.now(),
    });
    assert.ok(sessionApiPromptTokenCache.get(sessionId) != null);

    const result = await runCompaction(
      {
        sessionKkv: ctx.sessionKkv,
        messages: ctx.messages,
        messageTranscriptEffects: effects,
      },
      { sessionId, projectId: project.id },
    );

    assert.equal(result.ok, true);

    // hide-message 确实 hide 了消息（depth>=6 的前缀被置 hidden）。
    const list = await ctx.messages.listBySession(sessionId);
    const hiddenCount = list.filter((m) => m.hidden).length;
    assert.ok(hiddenCount > 0, "expected some messages to be hidden");

    // rule_snapshot / file_cache 被清空。
    const snapKeys = await ctx.sessionKkv.listKeys(sessionId, RULE_SNAPSHOT);
    const fcKeys = await ctx.sessionKkv.listKeys(sessionId, FILE_CACHE);
    assert.deepEqual(snapKeys, []);
    assert.deepEqual(fcKeys, []);

    // prompt token cache 失效。
    assert.equal(sessionApiPromptTokenCache.get(sessionId), undefined);
  });

  it("T-CC3: hideStartDepth=10 时 hide-message 用 depth 10", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const sessionRow = await ctx.sessions.create(project.id);
    const sessionId = sessionRow.id;

    // 只放 3 条消息：startDepth=10 远超可见深度，
    // messageIdsInSlice 会返回空 → hide-messages 不 hide 任何消息，
    // 但 runCompaction 仍走完整流程（清 kkv + invalidate cache）并返回 ok。
    await appendMany(ctx.messages, sessionId, [
      "user",
      "assistant",
      "user",
    ]);

    const effects = createMessageTranscriptEffectsService(ctx.conn);
    await ctx.sessionKkv.set(sessionId, RULE_SNAPSHOT, "canon", "snap");
    sessionApiPromptTokenCache.set(sessionId, {
      promptTokens: 99,
      updatedAt: Date.now(),
    });

    const result = await runCompaction(
      {
        sessionKkv: ctx.sessionKkv,
        messages: ctx.messages,
        messageTranscriptEffects: effects,
      },
      { sessionId, projectId: project.id, hideStartDepth: 10 },
    );

    assert.equal(result.ok, true);

    // startDepth=10 超过消息总数，不应 hide 任何消息。
    const list = await ctx.messages.listBySession(sessionId);
    assert.equal(list.filter((m) => m.hidden).length, 0);

    // 但 kkv 清理 + cache 失效仍执行（hide-message 无匹配不视为失败）。
    const snapKeys = await ctx.sessionKkv.listKeys(sessionId, RULE_SNAPSHOT);
    assert.deepEqual(snapKeys, []);
    assert.equal(sessionApiPromptTokenCache.get(sessionId), undefined);
  });

  it("T-CC4: hide-message 抛异常时返回 { ok: false }，不 crash 且不清 kkv", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const sessionRow = await ctx.sessions.create(project.id);
    const sessionId = sessionRow.id;

    await appendMany(ctx.messages, sessionId, [
      "user",
      "assistant",
      "user",
      "user",
      "assistant",
      "assistant",
      "assistant",
      "assistant",
      "assistant",
      "assistant",
    ]);

    // 预置 kkv + cache，验证异常路径下不会被清（与旧编排器 result.ok 门控一致）。
    await ctx.sessionKkv.set(sessionId, RULE_SNAPSHOT, "canon", "snap");
    await ctx.sessionKkv.set(sessionId, FILE_CACHE, "fc-key", "fc-val");
    sessionApiPromptTokenCache.set(sessionId, {
      promptTokens: 555,
      updatedAt: Date.now(),
    });

    const result = await runCompaction(
      {
        sessionKkv: ctx.sessionKkv,
        messages: ctx.messages,
        messageTranscriptEffects: throwingEffects(),
      },
      { sessionId, projectId: project.id },
    );

    assert.equal(result.ok, false);

    // 异常路径不清 kkv、不失效 cache。
    const snapKeys = await ctx.sessionKkv.listKeys(sessionId, RULE_SNAPSHOT);
    const fcKeys = await ctx.sessionKkv.listKeys(sessionId, FILE_CACHE);
    assert.deepEqual(snapKeys, ["canon"]);
    assert.deepEqual(fcKeys, ["fc-key"]);
    assert.ok(sessionApiPromptTokenCache.get(sessionId) != null);
  });
});
