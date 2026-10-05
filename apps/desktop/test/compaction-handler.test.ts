/**
 * Manual 压缩 IPC 测试：handleCompactionManual 调 runCompaction 后的行为。
 *
 * T-IPC1R（原 T-IPC1 反转）：runCompaction 以 `trigger:"manual"` 成功后**清掉**
 * 预置的 session kkv（file_cache / rule_snapshot 都空——手动压缩是用户主动的
 * 重整意图，下一次拼提示词时 workplace 块按当前工作区重评估；自动压缩才不清），
 * 保留 user_vfs_pending，并调 notifyComposerStatusAfterFloorOrCompaction。
 * 该函数最终经 notifyComposerAttachmentsSuggestToRenderer 向 renderer 广播
 * COMPOSER_ATTACHMENTS_SUGGEST，用 setComposerAttachmentsSuggestForwardTarget 注入假 webContents
 * 捕获 send，即可观测调用是否发生（与同目录其他测试同范式）。
 *
 * T-CR6：run 在途时手动压缩被拦。注入方式是向 `rt.abortRegistry` 真注册一个
 * controller（`isDesktopSessionRunInFlight` 的判定源；desktop 测试运行器未开
 * `--experimental-test-module-mocks`，**不能用 mock.module**，先例见
 * chat-prompt-tokens-run-suppression.test.ts 的 registerRunInFlight）。
 * 断言走副作用代理（拦下时 runCompaction 压根没跑）：composer 广播 0 次 +
 * 两域 listKeys 与触发前一致。
 *
 * T-CR5：原测 condition 压缩走 eventOrchestrator.emit 的旧路径（Step 9 已删该装配）。
 * Step 20 改为测 runCompaction：验证「无预置 kkv」的干净 session 下再次调
 * handleCompactionManual（内部走 runCompaction）仍返回 data.ok=true 并触发 composer 广播——
 * 覆盖了 T-IPC1R（预置了 kkv）未验证的维度，即 runCompaction 对空 kkv 的容错。
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

  it("T-IPC1R: manual 压缩（trigger:manual）成功后清 file_cache / rule_snapshot，保留 pending", async () => {
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

    // 入口传了 trigger:"manual"，runCompaction 成功后清两域。
    assert.deepEqual(await rt.sessionKkv.listKeys(sessionId, "file_cache"), [
      "full:/a.md",
    ]);
    assert.deepEqual(await rt.sessionKkv.listKeys(sessionId, "rule_snapshot"), [
      "canon",
    ]);

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
    // 手动压缩是用户主动的「重整 + 刷新」意图：按内容寻址的 file_cache 与
    // workplace 规则快照一并作废，下一次拼提示词（发送或预览）时 workplace
    // 块按当前工作区重评估（新文件进清单、正文重读）。
    assert.deepEqual(
      await rt.sessionKkv.listKeys(sessionId, "file_cache"),
      [],
      "手动压缩应清空 file_cache（workplace 刷新前置）",
    );
    assert.deepEqual(
      await rt.sessionKkv.listKeys(sessionId, "rule_snapshot"),
      [],
      "手动压缩应清空 rule_snapshot（workplace 规则重评估前置）",
    );
    // user_vfs_pending 不在清理范围内：它是待执行的写盘动作队列，与
    // workplace 刷新正交。
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

  /**
   * T-CR6：run 在途时手动压缩被 main 侧门禁拦下。
   *
   * 为什么注入 abortRegistry 真态而不是 mock 掉 runCompaction：desktop 测试
   * 运行器没开 `--experimental-test-module-mocks`，`mock.module` 不可用；判活源
   * 写死 `rt.abortRegistry.has(sessionId)`，而 abortRegistry 是 core 受理 run 时
   * 自己登记的，desktop 侧没有可写的影子——只能按 `runAgentTurn` 入口同款真
   * 注册一个 controller（先例：chat-prompt-tokens-run-suppression.test.ts 的
   * registerRunInFlight）。
   *
   * 断言走**副作用代理**（拦下时 runCompaction 压根没被调用，spy 本体做不到）：
   * ①返回 error 形态（`IpcResult` 既有失败分支，无 data 层 reason 字段）；
   * ②composer 广播 0 次；③两域 listKeys 与触发前逐字相同——先预置各一键，
   * 防「空对空恒真」。
   */
  it("T-CR6: run 在途时手动压缩被拦（AGENT_RUN_IN_FLIGHT），不广播不清理", async () => {
    const rt = await getDesktopRuntime();

    // 独立会话：不污染 T-CR5「无预置 kkv」的干净前提（同 T-IPC2 的做法）。
    const session = await handleSessionsCreate({
      projectId,
      title: "compaction-run-in-flight",
    });
    assert.equal(session.ok, true, session.ok ? "" : session.error.message);
    if (!session.ok) {
      return;
    }
    const cr6SessionId = session.data.id;

    // 预置：先让两域非空，拦截后必须原样保留。
    await rt.sessionKkv.set(
      cr6SessionId,
      "file_cache",
      "full:/cr6.md",
      JSON.stringify({ body: "y", mtimeMs: 2 }),
    );
    await rt.sessionKkv.set(
      cr6SessionId,
      "rule_snapshot",
      "canon-cr6",
      "[]",
    );

    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    // 伪造成「run 在途」：向 core abortRegistry 注册一个 controller。
    const controller = new AbortController();
    rt.abortRegistry.register(cr6SessionId, controller);

    try {
      const result = await handleCompactionManual({
        projectId,
        sessionId: cr6SessionId,
      });
      assert.equal(result.ok, false);
      assert.equal(
        result.ok ? undefined : result.error.code,
        "AGENT_RUN_IN_FLIGHT",
      );
      assert.equal(
        result.ok ? undefined : result.error.message,
        "Agent 运行中无法压缩",
      );

      const composerBroadcasts = sent.filter(
        (s) => s.channel === IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST,
      );
      assert.equal(
        composerBroadcasts.length,
        0,
        "被拦下时不得进入 runCompaction 成功分支，故不应广播 composer 状态",
      );

      assert.deepEqual(
        await rt.sessionKkv.listKeys(cr6SessionId, "file_cache"),
        ["full:/cr6.md"],
        "被拦下时不得清 file_cache",
      );
      assert.deepEqual(
        await rt.sessionKkv.listKeys(cr6SessionId, "rule_snapshot"),
        ["canon-cr6"],
        "被拦下时不得清 rule_snapshot",
      );
    } finally {
      rt.abortRegistry.unregister(cr6SessionId, controller);
      setComposerAttachmentsSuggestForwardTarget(() => undefined);
    }
  });

  // T-CR5：原测 condition 压缩走 eventOrchestrator.emit（Step 9 已删），
  // Step 20 改为测 runCompaction 对「无预置 kkv」的干净 session 的容错。
  // T-IPC1R 预置了 file_cache / rule_snapshot / user_vfs_pending；本用例不预置，
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
