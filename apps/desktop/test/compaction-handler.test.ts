/**
 * Manual 压缩 IPC 测试：handleCompactionManual 调 runCompaction 后的行为。
 *
 * T-IPC1：runCompaction 成功后**不清**预置的 session kkv（file_cache /
 * rule_snapshot 都保留——2026-09-29 修正：压缩只动消息可见性，与按内容
 * 寻址的文件缓存正交；置位 / 导入 / 规则刷新才清），保留 user_vfs_pending，
 * 并调 notifyComposerStatusAfterFloorOrCompaction（SPEC L274）。
 * 该函数最终经 notifyComposerAttachmentsSuggestToRenderer 向 renderer 广播
 * COMPOSER_ATTACHMENTS_SUGGEST，用 setComposerAttachmentsSuggestForwardTarget 注入假 webContents
 * 捕获 send，即可观测调用是否发生（与同目录其他测试同范式）。
 *
 * T-CR5：原测 condition 压缩走 eventOrchestrator.emit 的旧路径（Step 9 已删该装配）。
 * Step 20 改为测 runCompaction：验证「无预置 kkv 数据」的干净 session 下再次调
 * handleCompactionManual（内部走 runCompaction）仍返回 data.ok=true 并触发 composer 广播——
 * 覆盖了 T-IPC1（预置了 kkv）未验证的维度，即 runCompaction 对空 kkv 的容错。
 *
 * T-IPC2：手动压缩返回前必须已完成 prompt 占用的精确档预热
 * （`await warmChatPromptTokenStatsAfterCompaction`），否则 renderer 压缩完成后
 * 的那次刷新首帧会落到 `gpt ≈`，用户看到 chip 跳变。
 *
 * T-IPC2b（r3-cache-1）：同样的判据，但**读口暖机在途时**也必须成立——压缩暖机
 * 与读口暖机分属两个 inflight Set，被共用去重挡下时预热不会跑，IPC 仍会返回，
 * 但那一刻精确档并不就绪。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  promptWholeCache,
  sessionApiPromptTokenCache,
} from "@novel-master/core/provider";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleCompactionManual } from "../src/main/ipc/handlers/compaction.js";
import { handleMessagesAppend } from "../src/main/ipc/handlers/messages.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleProvidersCreate } from "../src/main/ipc/handlers/providers.js";
import { handleAgentRegistryCreateBlank } from "../src/main/ipc/handlers/agent-registry.js";
import { handleAgentSetCurrent } from "../src/main/ipc/handlers/agent.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import {
  IPC_CHANNELS,
  type PromptChatTokenUpdatedPayload,
} from "../shared/ipc-types.js";
import { setComposerAttachmentsSuggestForwardTarget } from "../src/main/ipc/forward-composer-attachments-suggest.js";
import { setPromptChatTokenUpdatedForwardTarget } from "../src/main/ipc/forward-prompt-chat-token-updated.js";
import {
  holdReadWarmInflightForTests,
  loadChatPromptTokenStats,
} from "../src/main/services/chat-prompt-tokens.service.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("handleCompactionManual", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-compaction-"));

    const project = await handleProjectsCreate({ name: "compaction-ipc" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;

    // 新 core 下 session 创建要求 workspace 已配置 agent。
    const blank = await handleAgentRegistryCreateBlank();
    assert.equal(blank.ok, true);
    if (blank.ok) {
      await handleAgentSetCurrent({ agentId: blank.data.agentId });
    }

    const session = await handleSessionsCreate({
      projectId,
      title: "compaction-session",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;

    await handleMessagesAppend({ sessionId, role: "user", text: "u1" });
    await handleMessagesAppend({ sessionId, role: "assistant", text: "a1" });
    await handleMessagesAppend({ sessionId, role: "user", text: "u2" });
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("T-IPC1: manual 压缩 runCompaction 成功后不清 file_cache / rule_snapshot（2026-09-29 修正），保留 pending", async () => {
    const rt = await getDesktopRuntime();
    const pendingJson = JSON.stringify([
      {
        actionXml: '<action name="mkdir"><path>/keep</path></action>',
        tools: [{ id: "t1", name: "vfs_mkdir" }],
        createdAtMs: 1,
      },
    ]);
    await rt.sessionKkv.set(
      sessionId,
      "file_cache",
      "full:/a.md",
      JSON.stringify({ body: "x", mtimeMs: 1 }),
    );
    await rt.sessionKkv.set(sessionId, "rule_snapshot", "canon", "[]");
    await rt.sessionKkv.set(
      sessionId,
      "user_vfs_pending",
      "queue",
      pendingJson,
    );

    // SPEC L274：runCompaction 成功后调 notifyComposerStatusAfterFloorOrCompaction，
    // 该函数最终经 notifyComposerAttachmentsSuggestToRenderer 向 renderer 广播
    // COMPOSER_ATTACHMENTS_SUGGEST。注入假 webContents 捕获 send（与同目录
    // notify-composer-status-after-kkv-clear.test.ts 同范式）。
    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    const result = await handleCompactionManual({ projectId, sessionId });
    assert.equal(result.ok, true);
    // 压缩只动消息可见性：file_cache / rule_snapshot 均保留（2026-09-29
    // 修正——历史行为是清两域，与按内容寻址的文件缓存正交且回合中段清
    // 缓存违背「前缀回合内冻结」不变量；置位 / 导入 / 规则刷新才清）。
    assert.equal(
      await rt.sessionKkv.get(sessionId, "file_cache", "full:/a.md"),
      JSON.stringify({ body: "x", mtimeMs: 1 }),
      "压缩不得清 file_cache",
    );
    assert.equal(
      await rt.sessionKkv.get(sessionId, "rule_snapshot", "canon"),
      "[]",
      "压缩不得清 rule_snapshot",
    );
    assert.equal(
      await rt.sessionKkv.get(sessionId, "user_vfs_pending", "queue"),
      pendingJson,
    );

    // notifyComposerStatusAfterFloorOrCompaction 被调用：发出一次 COMPOSER_ATTACHMENTS_SUGGEST，
    // payload 携带本次 sessionId。
    const composerBroadcasts = sent.filter(
      (s) => s.channel === IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST,
    );
    assert.equal(
      composerBroadcasts.length,
      1,
      "notifyComposerStatusAfterFloorOrCompaction should broadcast exactly once after successful runCompaction",
    );
    assert.deepEqual(composerBroadcasts[0]?.payload, {
      sessionId,
      attachments: [],
    });

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });

  // T-CR5：原测 condition 压缩走 eventOrchestrator.emit（Step 9 已删），
  // Step 20 改为测 runCompaction 对「无预置 kkv」的干净 session 的容错。
  // T-IPC1 预置了 file_cache / rule_snapshot / user_vfs_pending；本用例不预置，
  // 验证 runCompaction 在 kkv 空时仍返回 ok:true 并触发 composer 广播。
  //
  // 注意：core 侧 run-compaction.test.ts 已覆盖 runCompaction 的成败两路；
  // 本用例聚焦 IPC 层 handleCompactionManual → runCompaction → notify 的链路。
  it("T-CR5: 无预置 kkv 时 runCompaction 仍返回 ok 并触发 composer 广播", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    const result = await handleCompactionManual({ projectId, sessionId });
    assert.equal(result.ok, true);
    assert.equal(
      result.data?.ok,
      true,
      "data.ok 应透传 runCompaction 的 true（kkv 空 不影响成败）",
    );

    // 成功路径仍广播一次 COMPOSER_ATTACHMENTS_SUGGEST（与 T-IPC1 同口径）。
    const composerBroadcasts = sent.filter(
      (s) => s.channel === IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST,
    );
    assert.equal(
      composerBroadcasts.length,
      1,
      "runCompaction 成功时应广播一次 COMPOSER_ATTACHMENTS_SUGGEST",
    );

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });

  /**
   * T-IPC2：手动压缩**返回之前**已经把精确档暖好（chip 不跳 `gpt ≈`）。
   *
   * 判据是「IPC resolve 的那一刻推送已经发生」——不是轮询等待后的结果。
   * 若把 `await warmChatPromptTokenStatsAfterCompaction(...)` 改成 fire-and-forget，
   * 预热链还挂在 DB/分词器的 await 上，IPC 会先返回，这条断言立刻红。
   */
  it("T-IPC2: 压缩 IPC 返回前精确档已就绪（首帧不再回落 gpt ≈）", async () => {
    const rt = await getDesktopRuntime();

    // 本文件其它用例的会话没有可用模型（无 provider/savedModel），
    // resolveSavedModelId 会返回空 → 走 heuristic 早退，压根没有精确档可暖。
    // 这里现搭一个 gpt-4o 模型 + 独立会话，构造「本该有精确档」的前提。
    const provider = await handleProvidersCreate({
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      displayName: "openai-compaction",
      apiKey: "sk-test",
    });
    assert.equal(provider.ok, true, provider.ok ? "" : provider.error.message);
    if (!provider.ok) {
      return;
    }
    const saved = await rt.providerModels.save(
      provider.data.providerId,
      "gpt-4o",
    );
    await rt.state.setCurrentModelId(saved.id);

    const project = await handleProjectsCreate({ name: "compaction-warm-ipc" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    const session = await handleSessionsCreate({
      projectId: project.data.id,
      title: "compaction-warm",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    const warmSessionId = session.data.id;
    await handleMessagesAppend({
      sessionId: warmSessionId,
      role: "user",
      text: "他把伞收了，窗外的雨顺着玻璃往下淌，街灯在水洼里碎成一片橙。".repeat(
        8,
      ),
    });

    // L1 冷 + 无 API 基线：压缩后首帧本会落到 `gpt ≈`。
    sessionApiPromptTokenCache.clearAll();
    promptWholeCache.clearForTests();

    const pushed: PromptChatTokenUpdatedPayload[] = [];
    setPromptChatTokenUpdatedForwardTarget(
      () =>
        ({
          send: (channel: string, payload: unknown) => {
            if (channel === IPC_CHANNELS.PROMPT_CHAT_TOKEN_UPDATED) {
              pushed.push(payload as PromptChatTokenUpdatedPayload);
            }
          },
        }) as never,
    );

    try {
      const result = await handleCompactionManual({
        projectId: project.data.id,
        sessionId: warmSessionId,
      });
      assert.equal(result.ok, true);
      assert.equal(result.data?.ok, true);

      // 同步判据：IPC 一返回，精确档推送就已经发生（不是「等一会就来了」）。
      const hit = pushed.find((p) => p.sessionId === warmSessionId);
      assert.ok(
        hit != null,
        "压缩 IPC 返回前应已完成精确档预热并推送（await 被去掉就会红）",
      );
      assert.equal(hit.stats.estimated, false);
      assert.equal(hit.stats.counterKind, "tiktoken");
      assert.match(hit.stats.label, /^gpt = \S+ \/ 128k \(\d+%\)$/);

      // 另一条腿：L1 已暖 ⇒ renderer 压缩完成后的那次刷新首帧直读精确档。
      const firstFrame = await loadChatPromptTokenStats(rt, {
        projectId: project.data.id,
        sessionId: warmSessionId,
      });
      assert.equal(
        firstFrame.estimated,
        false,
        "压缩后首帧应已是精确档，不该回落 gpt ≈",
      );
      assert.equal(firstFrame.counterKind, "tiktoken");
    } finally {
      setPromptChatTokenUpdatedForwardTarget(() => undefined);
    }
  });

  /**
   * T-IPC2b：读口暖机在途（inflight 已占位）时，「IPC 返回那一刻精确档就绪」
   * 这条不变式**依然**成立。
   *
   * 为什么这是独立的一条：读口暖机是 void 出去的（`loadChatPromptTokenStatsNow`
   * 里 fire-and-forget），没有可 await 的句柄，压缩暖机没法「等它落定」。所以
   * 两条路径一旦共用一个 inflight Set，读口在途时压缩暖机会直接 return，
   * 预热一轮都不跑 —— 而 IPC 照样返回 ok，调用方看不出任何异常，跳变照旧。
   *
   * 构造前提只能靠置位（真实窗口只有几毫秒，撞不出来）。
   */
  it("T-IPC2b: 读口暖机在途（inflight 占位）时，压缩 IPC 返回那一刻精确档仍就绪", async () => {
    const rt = await getDesktopRuntime();

    // 前提与 T-IPC2 同款：现搭 gpt-4o + 独立会话（否则没有精确档可暖）。
    // 正文与 T-IPC2 刻意不同：L1 按内容指纹寻址，同文案会跨用例命中旧条目。
    const provider = await handleProvidersCreate({
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      displayName: "openai-compaction-2b",
      apiKey: "sk-test",
    });
    assert.equal(provider.ok, true, provider.ok ? "" : provider.error.message);
    if (!provider.ok) {
      return;
    }
    const saved = await rt.providerModels.save(
      provider.data.providerId,
      "gpt-4o",
    );
    await rt.state.setCurrentModelId(saved.id);

    const project = await handleProjectsCreate({ name: "compaction-warm-ipc-2b" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    const session = await handleSessionsCreate({
      projectId: project.data.id,
      title: "compaction-warm-2b",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    const warmSessionId = session.data.id;
    await handleMessagesAppend({
      sessionId: warmSessionId,
      role: "user",
      text: "巷口的修表铺还亮着灯，秒针走得很慢，像谁在替整条街数时间。".repeat(
        9,
      ),
    });

    sessionApiPromptTokenCache.clearAll();
    promptWholeCache.clearForTests();

    const pushed: PromptChatTokenUpdatedPayload[] = [];
    setPromptChatTokenUpdatedForwardTarget(
      () =>
        ({
          send: (channel: string, payload: unknown) => {
            if (channel === IPC_CHANNELS.PROMPT_CHAT_TOKEN_UPDATED) {
              pushed.push(payload as PromptChatTokenUpdatedPayload);
            }
          },
        }) as never,
    );

    // 构造前提：读口那一轮后台暖机仍在途。
    const releaseReadWarm = holdReadWarmInflightForTests(warmSessionId);
    try {
      const result = await handleCompactionManual({
        projectId: project.data.id,
        sessionId: warmSessionId,
      });
      assert.equal(result.ok, true);
      assert.equal(result.data?.ok, true);

      // 同步判据：IPC 一返回那一刻精确档推送就已经发生。
      // 若两个 inflight Set 被合并，这条会在此红——共用去重会把预热挡成 no-op。
      const hit = pushed.find((p) => p.sessionId === warmSessionId);
      assert.ok(
        hit != null,
        "读口暖机在途不得挡下压缩预热：IPC 返回那一刻精确档必须已就绪",
      );
      assert.equal(hit.stats.estimated, false);
      assert.equal(hit.stats.counterKind, "tiktoken");
      assert.match(hit.stats.label, /^gpt = \S+ \/ 128k \(\d+%\)$/);

      // 另一条腿：L1 已暖 ⇒ 压缩后 renderer 那次刷新的首帧直读精确档。
      const firstFrame = await loadChatPromptTokenStats(rt, {
        projectId: project.data.id,
        sessionId: warmSessionId,
      });
      assert.equal(
        firstFrame.estimated,
        false,
        "读口在途时压缩预热仍应把 L1 写热，首帧不该回落 gpt ≈",
      );
      assert.equal(firstFrame.counterKind, "tiktoken");
    } finally {
      releaseReadWarm();
      setPromptChatTokenUpdatedForwardTarget(() => undefined);
    }
  });
});
