/**
 * runCompaction 执行器测试（对应 SPEC T-CC1~T-CC4 与 T-CR1~T-CR4）。
 *
 * T-CC1 覆盖 v3 文档读迁移到 v4（store 层）；
 * T-CC2/T-CC3 用真实 DB fixture 验证 runCompaction 端到端副作用；
 * T-CC4 用抛异常的 messageTranscriptEffects stub 验证降级返回；
 * T-CR1 验证手动压缩清 `rule_snapshot` + `file_cache`，
 * T-CR1b 验证 hide 命中 0 条时 manual 仍清两域且 ok:true（短会话真实路径），
 * T-CR2 验证 auto（不传 trigger / 显式 "auto"）两域保留，
 * T-CR3 是 T-CC4 的 manual 变量断言（hide 失败 → ok:false 且两域不清），
 * T-CR4 验证清域失败只 warn、不把压缩成功翻成失败。
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
import { serializeSessionApiPromptTokenEntry } from "../../src/infra/tokenizer/logic/session-api-prompt-token-store.js";
import {
  PROMPT_TOKENS_LAST_USAGE_KEY,
  SESSION_KKV_DOMAIN_PROMPT_TOKENS,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
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

/** 读 prompt_tokens 域的落库原始值（null = 行不存在 / 已清）。 */
async function promptTokenRow(
  sessionId: string,
  sessionKkv: SessionKkvService = getNovelMasterTestContext().sessionKkv,
): Promise<string | null> {
  return sessionKkv.get(
    sessionId,
    SESSION_KKV_DOMAIN_PROMPT_TOKENS,
    PROMPT_TOKENS_LAST_USAGE_KEY,
  );
}

/** 落一条 prompt_tokens KKV 行（模拟上一轮 completed run 的落库值）。 */
async function seedPromptTokenRow(sessionId: string): Promise<void> {
  await getNovelMasterTestContext().sessionKkv.set(
    sessionId,
    SESSION_KKV_DOMAIN_PROMPT_TOKENS,
    PROMPT_TOKENS_LAST_USAGE_KEY,
    serializeSessionApiPromptTokenEntry({
      promptTokens: 1234,
      atMs: Date.now(),
    }),
  );
}

/**
 * 断言 prompt_tokens 行已被清掉。
 *
 * 失效删除现在被 `await`（runCompaction 内直接 await helper），所以 await
 * 返回后行必须已经消失——直接断言，不再轮询等待。
 */
async function assertPromptTokenRowGone(sessionId: string): Promise<void> {
  assert.equal(await promptTokenRow(sessionId), null);
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

  it("T-CC2 / T-CR2（auto 语义）：不传 trigger 或显式传 \"auto\" 时 hide 生效、两域保留、invalidate token cache", async () => {
    const ctx = getNovelMasterTestContext();

    // 两个变体各跑一遍独立会话：① 完全不传 trigger（既有调用零改动，缺省 auto）
    // ② 显式传 "auto"。语义必须完全一致——「把缺省改成显式 auto」这类实现漂移
    // 会让其中一条红。
    for (const trigger of [undefined, "auto"] as const) {
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

      // 预置 rule_snapshot / file_cache 数据，验证**自动**压缩不清这两域
      // （2026-09-29 修正：缓存与消息可见性正交，agent 回合中段压缩要保前缀冻结；
      // 用户主动的置位/导入/手动压缩才清）。
      await ctx.sessionKkv.set(sessionId, RULE_SNAPSHOT, "canon", "snap");
      await ctx.sessionKkv.set(sessionId, FILE_CACHE, "fc-key", "fc-val");
      // 预置 prompt token cache，验证会被 invalidate（热层 + KKV 行双删）。
      sessionApiPromptTokenCache.set(sessionId, {
        promptTokens: 1234,
        updatedAt: Date.now(),
      });
      await seedPromptTokenRow(sessionId);
      assert.ok(sessionApiPromptTokenCache.get(sessionId) != null);

      const result = await runCompaction(
        {
          sessionKkv: ctx.sessionKkv,
          messages: ctx.messages,
          messageTranscriptEffects: effects,
        },
        {
          sessionId,
          projectId: project.id,
          ...(trigger === undefined ? {} : { trigger }),
        },
      );

      assert.equal(result.ok, true);

      // hide-message 确实 hide 了消息（depth>=6 的前缀被置 hidden）。
      const list = await ctx.messages.listBySession(sessionId);
      const hiddenCount = list.filter((m) => m.hidden).length;
      assert.ok(hiddenCount > 0, "expected some messages to be hidden");

      // rule_snapshot / file_cache 保留（自动压缩不清，见 run-compaction 模块头注释）。
      const snapKeys = await ctx.sessionKkv.listKeys(sessionId, RULE_SNAPSHOT);
      const fcKeys = await ctx.sessionKkv.listKeys(sessionId, FILE_CACHE);
      assert.deepEqual(snapKeys, ["canon"]);
      assert.deepEqual(fcKeys, ["fc-key"]);

      // prompt token cache 失效（进程内热层 + session KKV 行双删）。
      assert.equal(sessionApiPromptTokenCache.get(sessionId), undefined);
      await assertPromptTokenRowGone(sessionId);
    }
  });

  it("T-CR1（manual 语义）：trigger=\"manual\" + ok:true → 清空 rule_snapshot + file_cache，token 失效断言不变", async () => {
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

    const effects = createMessageTranscriptEffectsService(ctx.conn);

    // 预置两域各一条：手动压缩后下一次组装按当前工作区完整刷新
    // （等价「手动调整工作区规则」的效果），所以这里必须都清掉。
    await ctx.sessionKkv.set(sessionId, RULE_SNAPSHOT, "canon", "snap");
    await ctx.sessionKkv.set(sessionId, FILE_CACHE, "fc-key", "fc-val");
    sessionApiPromptTokenCache.set(sessionId, {
      promptTokens: 1234,
      updatedAt: Date.now(),
    });
    await seedPromptTokenRow(sessionId);

    const result = await runCompaction(
      {
        sessionKkv: ctx.sessionKkv,
        messages: ctx.messages,
        messageTranscriptEffects: effects,
      },
      { sessionId, projectId: project.id, trigger: "manual" },
    );

    assert.equal(result.ok, true);

    // hide 语义不变。
    const list = await ctx.messages.listBySession(sessionId);
    assert.ok(
      list.filter((m) => m.hidden).length > 0,
      "expected some messages to be hidden",
    );

    // 两域皆空（观测口径走 listKeys，不加返回字段）。
    const snapKeys = await ctx.sessionKkv.listKeys(sessionId, RULE_SNAPSHOT);
    const fcKeys = await ctx.sessionKkv.listKeys(sessionId, FILE_CACHE);
    assert.deepEqual(snapKeys, []);
    assert.deepEqual(fcKeys, []);

    // prompt token cache 失效断言与 auto 路径完全一致（口径不变）。
    assert.equal(sessionApiPromptTokenCache.get(sessionId), undefined);
    await assertPromptTokenRowGone(sessionId);
  });

  it("T-CR1b：hide 无可隐藏范围（锚不出真用户输入）时 manual 仍清两域且 ok:true", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const sessionRow = await ctx.sessions.create(project.id);
    const sessionId = sessionRow.id;

    // 只放 2 条 assistant：depth 只有 1 / 0，都小于 startDepth=6，
    // slice 内一条消息都圈不进（更谈不上锚定真用户输入），hide 直接早退、
    // **不抛错也不隐藏任何消息**——短会话用户点「压缩上下文」的真实路径。
    await appendMany(ctx.messages, sessionId, ["assistant", "assistant"]);

    await ctx.sessionKkv.set(sessionId, RULE_SNAPSHOT, "canon", "snap");
    await ctx.sessionKkv.set(sessionId, FILE_CACHE, "fc-key", "fc-val");

    const result = await runCompaction(
      {
        sessionKkv: ctx.sessionKkv,
        messages: ctx.messages,
        messageTranscriptEffects:
          createMessageTranscriptEffectsService(ctx.conn),
      },
      {
        sessionId,
        projectId: project.id,
        hideStartDepth: 6,
        trigger: "manual",
      },
    );

    // spec《总体方案》口径：`ok:true` 即刷，**与 hide 实际命中数无关**。
    assert.equal(result.ok, true);

    // 一条都没隐藏（本用例存在的意义：盖住「hide 命中 0 条」这条分支）。
    const list = await ctx.messages.listBySession(sessionId);
    assert.equal(list.filter((m) => m.hidden).length, 0);

    // 两域照清：把清域挪进 `hiddenCount > 0` 分支（看似自然的优化）时本用例红。
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(sessionId, RULE_SNAPSHOT),
      []
    );
    assert.deepEqual(await ctx.sessionKkv.listKeys(sessionId, FILE_CACHE), []);
  });

  it("T-CR4（manual 容错）：clearDomain 抛错时吞错 + warn，ok:true 照旧返回", async () => {
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

    await ctx.sessionKkv.set(sessionId, RULE_SNAPSHOT, "canon", "snap");
    await ctx.sessionKkv.set(sessionId, FILE_CACHE, "fc-key", "fc-val");

    // 只在清 workplace 两域时抛错；其余方法（尤其 invalidate 用的 delete）照常转发。
    const boomKkv = new Proxy(ctx.sessionKkv, {
      get(target, prop, receiver) {
        if (prop === "clearDomain") {
          return async () => {
            throw new Error("boom-from-clear-domain");
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function"
          ? value.bind(target)
          : value;
      },
    }) as SessionKkvService;

    const warns: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args);
    };
    let result;
    try {
      result = await runCompaction(
        {
          sessionKkv: boomKkv,
          messages: ctx.messages,
          messageTranscriptEffects:
            createMessageTranscriptEffectsService(ctx.conn),
        },
        { sessionId, projectId: project.id, trigger: "manual" },
      );
    } finally {
      console.warn = originalWarn;
    }

    // 压缩本身是成功的：清域失败不得把它翻成失败（file_cache 只是加速层）。
    assert.equal(result.ok, true);
    // 吞错但留痕：至少一条 warn 指向 runCompaction 的清域路径。
    assert.ok(warns.length >= 1, "expected a console.warn for the failed clear");
    assert.ok(
      warns.some((args) =>
        String(args[0]).includes("runCompaction"),
      ),
      `expected warn tagged runCompaction, got ${JSON.stringify(warns[0])}`,
    );
    // hide 与 token 失效都不受清域异常影响。
    const list = await ctx.messages.listBySession(sessionId);
    assert.ok(list.filter((m) => m.hidden).length > 0);
  });

  it("T-CC3（auto 语义）：hideStartDepth=10 时 hide-message 用 depth 10", async () => {
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
    await seedPromptTokenRow(sessionId);

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

    // 但 cache 失效仍执行（hide-message 无匹配不视为失败）；
    // rule_snapshot 不清（2026-09-29 修正，见 run-compaction 头注释）。
    const snapKeys = await ctx.sessionKkv.listKeys(sessionId, RULE_SNAPSHOT);
    assert.deepEqual(snapKeys, ["canon"]);
    assert.equal(sessionApiPromptTokenCache.get(sessionId), undefined);
    await assertPromptTokenRowGone(sessionId);
  });

  it("T-CC4 / T-CR3（manual 变量）：hide-message 抛异常时返回 { ok: false }，不 crash 且两域不清", async () => {
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
    // 用 trigger="manual" 这个变量：hide 失败的早 return 必须发生在清域之前，
    // 否则手动压缩会把「hide 没生效」也刷成 workplace 刷新。
    await ctx.sessionKkv.set(sessionId, RULE_SNAPSHOT, "canon", "snap");
    await ctx.sessionKkv.set(sessionId, FILE_CACHE, "fc-key", "fc-val");
    sessionApiPromptTokenCache.set(sessionId, {
      promptTokens: 555,
      updatedAt: Date.now(),
    });
    await seedPromptTokenRow(sessionId);

    const result = await runCompaction(
      {
        sessionKkv: ctx.sessionKkv,
        messages: ctx.messages,
        messageTranscriptEffects: throwingEffects(),
      },
      { sessionId, projectId: project.id, trigger: "manual" },
    );

    assert.equal(result.ok, false);

    // 异常路径不清 kkv、不失效 cache——manual 也不例外（hide 失败 ⇒ 不刷）。
    const snapKeys = await ctx.sessionKkv.listKeys(sessionId, RULE_SNAPSHOT);
    const fcKeys = await ctx.sessionKkv.listKeys(sessionId, FILE_CACHE);
    assert.deepEqual(snapKeys, ["canon"]);
    assert.deepEqual(fcKeys, ["fc-key"]);
    assert.ok(sessionApiPromptTokenCache.get(sessionId) != null);
    // KKV 行同样保留（result.ok 门控：压缩失败不得清任何缓存）
    assert.ok((await promptTokenRow(sessionId)) != null);
  });
});
