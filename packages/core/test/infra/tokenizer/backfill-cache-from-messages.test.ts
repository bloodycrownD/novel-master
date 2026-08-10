/**
 * T-S3 / T-S4：backfillCacheFromMessages + cache miss 回填后 resolve 走 api。
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { registerNodeTokenizerDriverForTests } from "../../helpers/register-node-tokenizer-driver-for-tests.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";
import {
  backfillCacheFromMessages,
  createDefaultTokenCounterRegistry,
  resolveCurrentPromptTokens,
  sessionApiPromptTokenCache,
} from "../../../src/infra/tokenizer/index.js";
import { emptyRegistryDeps } from "./registry-test-helpers.js";

const SESSION_ID = "sess-backfill";

function msg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, "role" | "createdAtMs">,
): ChatMessage {
  return {
    id: partial.id ?? `m-${partial.createdAtMs}`,
    sessionId: SESSION_ID,
    seq: partial.seq ?? 0,
    content: partial.content ?? { blocks: [{ type: "text", text: "" }] },
    provider: partial.provider ?? null,
    raw: partial.raw ?? null,
    hidden: partial.hidden ?? false,
    ...partial,
  } as ChatMessage;
}

describe("backfillCacheFromMessages", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
    sessionApiPromptTokenCache.clearAll();
  });

  afterEach(() => {
    sessionApiPromptTokenCache.clearAll();
  });

  it("T-S3: 从末尾往前找到最后一条非 hidden 带 usage 的 assistant message", () => {
    const messages: ChatMessage[] = [
      msg({
        role: "assistant",
        createdAtMs: 100,
        usage: { promptTokens: 111 },
      }),
      msg({
        role: "assistant",
        createdAtMs: 200,
        usage: { promptTokens: 222 },
      }),
      msg({ role: "user", createdAtMs: 300 }),
    ];

    const ok = backfillCacheFromMessages(SESSION_ID, messages);
    assert.equal(ok, true);

    const cached = sessionApiPromptTokenCache.get(SESSION_ID);
    assert.ok(cached);
    assert.equal(cached.promptTokens, 222);
    // updatedAt 用的是消息产生时刻，不是 Date.now()
    assert.equal(cached.updatedAt, 200);
  });

  it("T-S3: hidden 的 assistant 跳过，取更早的非 hidden assistant", () => {
    const messages: ChatMessage[] = [
      msg({
        role: "assistant",
        createdAtMs: 100,
        usage: { promptTokens: 111 },
      }),
      msg({
        role: "assistant",
        createdAtMs: 200,
        hidden: true,
        usage: { promptTokens: 999 },
      }),
    ];

    const ok = backfillCacheFromMessages(SESSION_ID, messages);
    assert.equal(ok, true);

    const cached = sessionApiPromptTokenCache.get(SESSION_ID);
    assert.ok(cached);
    assert.equal(cached.promptTokens, 111);
    assert.equal(cached.updatedAt, 100);
  });

  it("T-S3: 没有任何符合条件的候选返回 false，cache 不被写入", () => {
    const messages: ChatMessage[] = [
      msg({ role: "user", createdAtMs: 100 }),
      msg({
        role: "assistant",
        createdAtMs: 200,
        hidden: true,
        usage: { promptTokens: 999 },
      }),
      msg({ role: "assistant", createdAtMs: 300 }),
    ];

    const ok = backfillCacheFromMessages(SESSION_ID, messages);
    assert.equal(ok, false);
    assert.equal(sessionApiPromptTokenCache.get(SESSION_ID), undefined);
  });

  it("T-S4: cache miss + 回填命中后，resolveCurrentPromptTokens 返回 source=api", async () => {
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());

    // 第一次 resolve：cache 未命中 → local
    const params = {
      layout: { persist: [], dynamic: [] },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: "openai/gpt-4o",
      registry,
    };
    const before = await resolveCurrentPromptTokens(SESSION_ID, params);
    assert.equal(before.source, "local");

    // 从历史消息回填
    const messages: ChatMessage[] = [
      msg({
        role: "assistant",
        createdAtMs: 1234,
        usage: { promptTokens: 42_000 },
      }),
    ];
    const ok = backfillCacheFromMessages(SESSION_ID, messages);
    assert.equal(ok, true);

    // 第二次 resolve：cache 命中 → api
    const after = await resolveCurrentPromptTokens(SESSION_ID, params);
    assert.equal(after.source, "api");
    assert.equal(after.tokenCount, 42_000);
    assert.equal(after.estimated, false);
    assert.equal(after.counterKind, "api");
  });
});
