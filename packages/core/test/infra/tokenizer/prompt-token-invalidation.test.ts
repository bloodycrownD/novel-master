/**
 * prompt 占用失效挂点回归：凡改变「当前可见 prompt / 模型绑定」的路径，
 * 成功后必须把 session KKV 里的 `prompt_tokens` 行清掉（进程内热层由同一
 * helper 一起清）。
 *
 * 覆盖挂点：
 * - message.service：delete / updateContent / hide / truncateAfter
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
 * 失效是 fire-and-forget（KKV 删除不阻塞调用方）：轮询等行消失。
 * 50 × 5ms 上限，超时即判失败（行仍在）。
 */
async function waitRowGone(
  sessionKkv: SessionKkvService,
  sessionId: string
): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const raw = await sessionKkv.get(
      sessionId,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY
    );
    if (raw == null) {
      assert.equal(
        sessionApiPromptTokenCache.get(sessionId),
        undefined,
        "进程内热层应同步清空"
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`prompt_tokens 行未被清掉（session=${sessionId}）`);
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

  it("message.delete 后 KKV 行被清", async () => {
    const { ctx, session } = await makeSession();
    const message = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("hi")
    );
    await seedRow(ctx.sessionKkv, session.id);

    await ctx.messages.delete(message.id);
    await waitRowGone(ctx.sessionKkv, session.id);
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
    await waitRowGone(ctx.sessionKkv, session.id);
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
    await waitRowGone(ctx.sessionKkv, session.id);
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
    await waitRowGone(ctx.sessionKkv, session.id);
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
    await waitRowGone(ctx.sessionKkv, session.id);
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
    await waitRowGone(ctx.sessionKkv, session.id);
  });

  it("切模型（state.setCurrentModelId）后 KKV 行被清", async () => {
    const { ctx, session } = await makeSession();
    await ctx.state.setCurrentSessionId(session.id);
    await seedRow(ctx.sessionKkv, session.id);

    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);
    await waitRowGone(ctx.sessionKkv, session.id);
  });

  it("切换 Agent（state.setCurrentAgentId）后 KKV 行被清", async () => {
    const { ctx, session } = await makeSession();
    await ctx.state.setCurrentSessionId(session.id);
    await seedRow(ctx.sessionKkv, session.id);

    await ctx.state.setCurrentAgentId("test-default-agent");
    await waitRowGone(ctx.sessionKkv, session.id);
  });

  it("导入对齐（clearSessionPromptCaches）后 KKV 行被清，pending 域保留", async () => {
    const { ctx, session } = await makeSession();
    await seedRow(ctx.sessionKkv, session.id);
    await ctx.sessionKkv.set(session.id, "user_vfs_pending", "queue", "[]");

    await clearSessionPromptCaches(session.id, ctx.sessionKkv);
    await waitRowGone(ctx.sessionKkv, session.id);

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
