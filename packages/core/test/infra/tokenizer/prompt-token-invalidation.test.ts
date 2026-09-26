/**
 * prompt 占用失效挂点回归：凡改变「当前可见 prompt / 模型绑定」的路径，
 * 成功后必须把 session KKV 里的 `prompt_tokens` 行清掉（进程内热层由同一
 * helper 一起清）。
 *
 * 覆盖挂点：
 * - message.service：append / delete / updateContent / hide / truncateAfter
 * - session.service：updateSessionAgentConfig（会话级切 Agent / 切模型）
 * - message-checkpoint：rollbackToMessage（回滚）
 * - message-transcript-effects：setMessageFloorAtMessage（置位）
 * - persistent-state：setCurrentModelId（切模型 / 切 Agent）
 * - vfs：clearSessionPromptCaches（导入后对齐）
 *
 * 压缩（run-compaction）的同类断言在 `compaction-conditions/run-compaction.test.ts`。
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { textBlocks } from "../../../src/domain/chat/content/text-blocks.js";
import {
  PROMPT_TOKENS_LAST_USAGE_KEY,
  SESSION_KKV_DOMAIN_PROMPT_TOKENS,
} from "../../../src/domain/session-kkv/model/session-kkv-domains.js";
import { sessionApiPromptTokenCache } from "../../../src/infra/tokenizer/logic/session-api-prompt-token-cache.js";
import { serializeSessionApiPromptTokenEntry } from "../../../src/infra/tokenizer/logic/session-api-prompt-token-store.js";
import { createMessageTranscriptEffectsService } from "../../../src/service/chat/create-message-transcript-effects.js";
import { clearSessionPromptCaches } from "../../../src/service/vfs/logic/clear-session-prompt-caches.js";
import type { SessionKkvService } from "../../../src/service/session-kkv/session-kkv.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const TEST_SAVED_MODEL_ID = "00000000-0000-4000-8000-0000000000aa";

/** 预置一条 KKV 行（模拟上一轮 completed run 的落库值）。 */
async function seedRow(
  sessionKkv: SessionKkvService,
  sessionId: string
): Promise<void> {
  await sessionKkv.set(
    sessionId,
    SESSION_KKV_DOMAIN_PROMPT_TOKENS,
    PROMPT_TOKENS_LAST_USAGE_KEY,
    serializeSessionApiPromptTokenEntry({
      promptTokens: 4321,
      atMs: Date.now(),
      runId: "run-previous",
    })
  );
  sessionApiPromptTokenCache.set(sessionId, {
    promptTokens: 4321,
    updatedAt: Date.now(),
  });
}

/**
 * 断言该会话的 prompt_tokens 行已被清掉（进程内热层同步清 + KKV 行删除）。
 *
 * 失效删除现在被所有 async 调用方 `await`（agent-runner 的 run 收尾两处
 * 除外，它们刻意保持 fire-and-forget），所以 await 返回后行必须已经消失——
 * 直接断言，不再轮询等待。
 */
async function assertRowGone(
  sessionKkv: SessionKkvService,
  sessionId: string
): Promise<void> {
  const raw = await sessionKkv.get(
    sessionId,
    SESSION_KKV_DOMAIN_PROMPT_TOKENS,
    PROMPT_TOKENS_LAST_USAGE_KEY
  );
  assert.equal(raw, null, "prompt_tokens 行应已被清");
  assert.equal(
    sessionApiPromptTokenCache.get(sessionId),
    undefined,
    "进程内热层应同步清空"
  );
}

async function makeSession() {
  const ctx = getNovelMasterTestContext();
  const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
  const session = await ctx.sessions.create(project.id);
  return { ctx, project, session };
}

describe("prompt 占用失效挂点", () => {
  beforeEach(() => {
    sessionApiPromptTokenCache.clearAll();
  });

  it("message.append 后 KKV 行被清（消息「增」这一环）", async () => {
    const { ctx, session } = await makeSession();
    await seedRow(ctx.sessionKkv, session.id);

    await ctx.messages.append(session.id, "user", textBlocks("new turn"));
    await assertRowGone(ctx.sessionKkv, session.id);
  });

  it("message.delete 后 KKV 行被清", async () => {
    const { ctx, session } = await makeSession();
    const message = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("hi")
    );
    await seedRow(ctx.sessionKkv, session.id);

    await ctx.messages.delete(message.id);
    await assertRowGone(ctx.sessionKkv, session.id);
  });

  it("message.updateContent 后 KKV 行被清", async () => {
    const { ctx, session } = await makeSession();
    const message = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("before")
    );
    await seedRow(ctx.sessionKkv, session.id);

    await ctx.messages.updateContent(message.id, textBlocks("after"));
    await assertRowGone(ctx.sessionKkv, session.id);
  });

  it("message.hide 后 KKV 行被清", async () => {
    const { ctx, session } = await makeSession();
    const message = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("hide me")
    );
    await seedRow(ctx.sessionKkv, session.id);

    await ctx.messages.hide(message.id);
    await assertRowGone(ctx.sessionKkv, session.id);
  });

  it("message.truncateAfter 后 KKV 行被清", async () => {
    const { ctx, session } = await makeSession();
    const first = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("keep")
    );
    await ctx.messages.append(session.id, "assistant", textBlocks("tail"));
    await seedRow(ctx.sessionKkv, session.id);

    await ctx.messages.truncateAfter(session.id, first.id);
    await assertRowGone(ctx.sessionKkv, session.id);
  });

  it("回滚（sessionFs.rollbackToMessage）后 KKV 行被清", async () => {
    const { ctx, project, session } = await makeSession();
    const svfs = ctx.sessionVfs(project.id, session.id);
    await ctx.messages.append(session.id, "user", textBlocks("poem"));
    const assistant1 = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("here")
    );
    await svfs.write("/rb.md", "anchor-body", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    await ctx.messages.append(session.id, "user", textBlocks("more"));
    const assistant2 = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("later")
    );
    await svfs.write("/rb.md", "later-body", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    await seedRow(ctx.sessionKkv, session.id);
    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id
    );
    await assertRowGone(ctx.sessionKkv, session.id);
  });

  it("置位（setMessageFloorAtMessage）后 KKV 行被清", async () => {
    const { ctx, project, session } = await makeSession();
    const anchor = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("anchor")
    );
    await ctx.messages.append(session.id, "assistant", textBlocks("reply"));
    await seedRow(ctx.sessionKkv, session.id);

    const effects = createMessageTranscriptEffectsService(ctx.conn);
    await effects.setMessageFloorAtMessage(project.id, session.id, anchor.id);
    await assertRowGone(ctx.sessionKkv, session.id);
  });

  it("切模型（state.setCurrentModelId）后 KKV 行被清", async () => {
    const { ctx, session } = await makeSession();
    await ctx.state.setCurrentSessionId(session.id);
    await seedRow(ctx.sessionKkv, session.id);

    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);
    await assertRowGone(ctx.sessionKkv, session.id);
  });

  it("切换 Agent（state.setCurrentAgentId）后 KKV 行被清", async () => {
    const { ctx, session } = await makeSession();
    await ctx.state.setCurrentSessionId(session.id);
    await seedRow(ctx.sessionKkv, session.id);

    await ctx.state.setCurrentAgentId("test-default-agent");
    await assertRowGone(ctx.sessionKkv, session.id);
  });

  it("切 Agent（sessions.updateSessionAgentConfig）后 KKV 行被清", async () => {
    const { ctx, session } = await makeSession();
    const before = await ctx.sessions.getSessionAgentConfig(session.id);
    await seedRow(ctx.sessionKkv, session.id);

    // agentId 变更时 savedModelId 指纹不变，读口没有任何 agent 指纹可作第二道
    // 防线：正确性完全依赖这一个失效挂点，所以它必须被本用例钉住。
    const after = await ctx.sessions.updateSessionAgentConfig(session.id, {
      agentId: "other-agent",
    });
    assert.notEqual(after.agentId, before.agentId);
    await assertRowGone(ctx.sessionKkv, session.id);
  });

  it("updateSessionAgentConfig 传与当前相同的配置 → KKV 行保留（收窄口径）", async () => {
    const { ctx, session } = await makeSession();
    const current = await ctx.sessions.getSessionAgentConfig(session.id);
    await seedRow(ctx.sessionKkv, session.id);

    // overlay 语义下 patch 常常带与当前相同的值（前端表单整体回传 / CLI 重放
    // 同配置）。这类无效写不该清缓存，否则收窄白写、还多一次 KKV 写。
    const after = await ctx.sessions.updateSessionAgentConfig(session.id, {
      agentId: current.agentId,
      ...(current.modelId != null ? { modelId: current.modelId } : {}),
    });
    assert.deepEqual(after, current);

    const raw = await ctx.sessionKkv.get(
      session.id,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY
    );
    assert.notEqual(raw, null, "配置未变时不应清掉 prompt_tokens 行");
    assert.equal(
      sessionApiPromptTokenCache.get(session.id)?.promptTokens,
      4321,
      "热层也应保留"
    );
  });

  it("导入对齐（clearSessionPromptCaches）后 KKV 行被清，pending 域保留", async () => {
    const { ctx, session } = await makeSession();
    await seedRow(ctx.sessionKkv, session.id);
    await ctx.sessionKkv.set(session.id, "user_vfs_pending", "queue", "[]");

    await clearSessionPromptCaches(session.id, ctx.sessionKkv);
    await assertRowGone(ctx.sessionKkv, session.id);

    assert.equal(
      await ctx.sessionKkv.get(session.id, "user_vfs_pending", "queue"),
      "[]",
      "导入对齐只清提示词相关域，pending 域保留"
    );
  });

  it("会话删除（clearSession 整表清）连带清掉 prompt_tokens 行", async () => {
    const { ctx, session } = await makeSession();
    await seedRow(ctx.sessionKkv, session.id);
    // 走 service 层会话删除：session_kkv 整表清是该路径的既有语义
    await ctx.sessions.delete(session.id);
    assert.equal(
      await ctx.sessionKkv.get(
        session.id,
        SESSION_KKV_DOMAIN_PROMPT_TOKENS,
        PROMPT_TOKENS_LAST_USAGE_KEY
      ),
      null
    );
  });
});
