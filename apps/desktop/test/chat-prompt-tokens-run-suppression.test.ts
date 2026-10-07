/**
 * r3-dt-align：desktop 对齐 mobile 四层防护（run 在途抑制 / 中途弃权 / 结束后补推）。
 *
 * 背景：mobile 真机实锤过「chip 读口的整串级重活与发送链共享同一 JS 线程与单条
 * SQLite 连接」——build 装配把 POST 派发从 +1.2s 拖到 +19.6s。desktop main 是同
 * 进程同连接，问题一模一样，落地前全链零抑制零弃权。本文件钉住四层里的三条可观测
 * 契约（第四条是渲染层「null 保留旧标签」，见文件末尾的源码断言）：
 *
 * - T-DA1：run 在途时读口**跳过本轮**（build 一次都不跑）且 IPC 回 `data:null`；
 * - T-DA2：终态补推**恰好一次**，且与抽屉自发的那次读口 IPC 合并成一次底层计算；
 * - T-DA3：build 途中 run 起步 → 本轮弃权（回 null）且**不进 fallback**；同一条
 *   探针在「真异常」下必须看到 fallback 照跑（证明这条断言不是恒真）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import type { WebContents } from "electron";
import { sessionApiPromptTokenCache } from "@novel-master/core/provider";
import {
  IPC_CHANNELS,
  type PromptChatTokenUpdatedPayload,
} from "../shared/ipc-types.js";
import {
  handleAgentSetCurrent,
  onCoreRunFailed,
  onCoreRunFinished,
  registerTrackedRunForTests,
} from "../src/main/ipc/handlers/agent.js";
import { handlePromptChatTokenLabel } from "../src/main/ipc/handlers/prompt.js";
import { handleAgentRegistryCreateBlank } from "../src/main/ipc/handlers/agent-registry.js";
import { handleMessagesAppend } from "../src/main/ipc/handlers/messages.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleProvidersCreate } from "../src/main/ipc/handlers/providers.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import { setPromptChatTokenUpdatedForwardTarget } from "../src/main/ipc/forward-prompt-chat-token-updated.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  chatPromptTokenDebounceExecCountForTests,
  loadChatPromptTokenStatsResilient,
  resetChatPromptTokenDebounceForTests,
} from "../src/main/services/chat-prompt-tokens.service.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 把某 session 伪造成「run 在途」：直接向 core 的 abortRegistry 注册一个
 * controller（与 runAgentTurn 入口同款），返回释放函数。
 *
 * 为什么不用 activeRuns 伪造：判活源写死 `rt.abortRegistry.has(sessionId)`，
 * 而 abortRegistry 是 core 受理 run 时自己登记的，desktop 侧没有可写的影子。
 */
async function registerRunInFlight(
  sessionId: string,
): Promise<() => Promise<void>> {
  const rt = await getDesktopRuntime();
  const controller = new AbortController();
  rt.abortRegistry.register(sessionId, controller);
  return async () => {
    rt.abortRegistry.unregister(sessionId, controller);
  };
}

describe("chat-prompt-tokens：run 在途四层防护（r3-dt-align）", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;
  const pushed: PromptChatTokenUpdatedPayload[] = [];

  /** 等某 sessionId 的底层计算执行次数达到 target（带截止，避免用例悬挂）。 */
  async function waitForExecCount(
    id: string,
    target: number,
    timeoutMs = 5000,
  ): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const count = chatPromptTokenDebounceExecCountForTests(id);
      if (count >= target) {
        return count;
      }
      await sleep(25);
    }
    return chatPromptTokenDebounceExecCountForTests(id);
  }

  before(async () => {
    setPromptChatTokenUpdatedForwardTarget(
      () =>
        ({
          send: (channel: string, payload: unknown) => {
            if (channel === IPC_CHANNELS.PROMPT_CHAT_TOKEN_UPDATED) {
              pushed.push(payload as PromptChatTokenUpdatedPayload);
            }
          },
        }) as unknown as WebContents,
    );

    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-dt-align-"));

    const project = await handleProjectsCreate({ name: "dt-align" });
    assert.equal(project.ok, true);
    if (!project.ok) return;
    projectId = project.data.id;

    const agent = await handleAgentRegistryCreateBlank();
    assert.equal(agent.ok, true);
    if (!agent.ok) return;
    const setAgent = await handleAgentSetCurrent({ agentId: agent.data.agentId });
    assert.equal(setAgent.ok, true);

    const provider = await handleProvidersCreate({
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      displayName: "openai-dt-align",
      apiKey: "sk-test",
    });
    assert.equal(provider.ok, true, provider.ok ? "" : provider.error.message);
    if (!provider.ok) return;
    const rt = await getDesktopRuntime();
    const saved = await rt.providerModels.save(provider.data.providerId, "gpt-4o");
    await rt.state.setCurrentModelId(saved.id);

    const session = await handleSessionsCreate({ projectId, title: "dt-align" });
    assert.equal(session.ok, true);
    if (!session.ok) return;
    sessionId = session.data.id;
    // 造点中文正文：空上下文会让「读到了读数」与「没读到」难以区分。
    await handleMessagesAppend({
      sessionId,
      role: "user",
      text: "他把伞收了，窗外的雨顺着玻璃往下淌，街灯在水洼里碎成一片橙。".repeat(6),
    });
  });

  after(async () => {
    sessionApiPromptTokenCache.clearAll();
    resetChatPromptTokenDebounceForTests();
    await teardownDesktopDbTestEnv(tempDir);
  });

  beforeEach(() => {
    sessionApiPromptTokenCache.clearAll();
    resetChatPromptTokenDebounceForTests();
    pushed.length = 0;
  });

  it("T-DA1: run 在途 ⇒ 读口跳过本轮（build 0 次）+ IPC 回 data:null", async () => {
    const rt = await getDesktopRuntime();
    const scope = { projectId, sessionId };

    // 探针：数 buildSessionPromptInput 的两处 runtime 足迹——第①段
    // `resolveAgentForProject` 读 session 配置、第②段 `listBySession` 取可见消息。
    // 命中入口抑制时**两处都该是 0**：只断言第②段会漏掉「入口没掐死、只是靠
    // build 第①个检查点抛错」那种半吊子实现（那样 resolve 前的 IO 照样跑过）。
    let listCalls = 0;
    let sessionConfigReads = 0;
    const countingMessages = new Proxy(rt.messages, {
      get(target, prop, receiver) {
        if (prop === "listBySession") {
          return async (...args: unknown[]) => {
            listCalls += 1;
            return (
              target.listBySession as (...a: unknown[]) => Promise<unknown>
            )(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const probeRt = new Proxy(rt, {
      get(target, prop, receiver) {
        if (prop === "messages") {
          return countingMessages;
        }
        if (prop === "sessions") {
          sessionConfigReads += 1;
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as typeof rt;

    const release = await registerRunInFlight(sessionId);
    try {
      // 腿一：service 层——跳过本轮并回 null 哨兵。
      const stats = await loadChatPromptTokenStatsResilient(probeRt, scope);
      assert.equal(stats, null, "run 在途时读口必须回 null（保留旧标签）");
      assert.equal(
        listCalls,
        0,
        "run 在途时连输入装配都不该起步（build 被调用即红）",
      );
      assert.equal(
        sessionConfigReads,
        0,
        "run 在途时不该连 agent 解析都起步（入口抑制缺失即红）",
      );

      // 腿二：IPC 层——{ok:true, data:null}，不是失败、也不是 0 值。
      const res = await handlePromptChatTokenLabel(scope);
      assert.equal(res.ok, true);
      assert.equal(res.ok ? res.data : "not-ok", null);
      assert.equal(
        listCalls,
        0,
        "IPC 读口在途也必须跳过（两次触发同样一次 build 都不许跑）",
      );
    } finally {
      await release();
    }
  });

  it("T-DA2a: run 终态后补推读口恰好一次（不经 renderer 触发）", async () => {
    // 补推只认 desktop 登记过的主 run（子 run 终态过滤），先把 run 登记进来。
    registerTrackedRunForTests(sessionId, "run-finished-1");
    // 没有 renderer、没有抽屉 IPC——若这次读口不是终态钩子补的，执行次数会停在 0。
    onCoreRunFinished({
      sessionId,
      projectId,
      runId: "run-finished-1",
      stopReason: "completed",
    });

    const count = await waitForExecCount(sessionId, 1);
    assert.equal(
      count,
      1,
      "RUN_FINISHED 后应补推一次读口（补跑槽的 desktop 等价物）",
    );
    // 恰好一次：再等一个完整的防抖窗口，不该冒出第二轮。
    await sleep(500);
    assert.equal(
      chatPromptTokenDebounceExecCountForTests(sessionId),
      1,
      "补推不应重复排轮（终态只补一拍）",
    );
  });

  it("T-DA2b: 补推与抽屉自发的读口 IPC 合并成一次底层计算", async () => {
    // 抽屉在 FINISHED 上会自发一次 reload（不在抑制范围：run 已结束），
    // 两条触发必须被 300ms 防抖合并——否则就是双跑一次整串重活。
    registerTrackedRunForTests(sessionId, "run-failed-1");
    onCoreRunFailed({
      sessionId,
      projectId,
      runId: "run-failed-1",
      error: "boom",
    });
    // 抽屉那次走的是同一条 IPC 通道（这里用真实 handler，不走内部函数）。
    const drawerRead = handlePromptChatTokenLabel({ projectId, sessionId });

    await waitForExecCount(sessionId, 1);
    await sleep(500);
    assert.equal(
      chatPromptTokenDebounceExecCountForTests(sessionId),
      1,
      "补推 + 抽屉 IPC 应合并成一次底层计算（不合并就是 2 次整串重活）",
    );
    // 合并后 caller 拿到的必须是真读数，不能是抑制态的 null。
    const res = await drawerRead;
    assert.equal(res.ok, true);
    assert.ok(
      res.ok && res.data != null,
      "run 已结束，抽屉那次读口必须拿到读数（null 说明被误判成在途）",
    );
  });

  it("T-DA2c: 子 run 终态不给子会话排读口（未登记的 sessionId 不补推）", async () => {
    // runChildAgent 的终态 payload 挂 childSessionId——desktop 从未登记过它。
    // 不过滤的话每个子代理 run 结束都会给子会话排一拍完整读口（build 整串
    // 重活 ×N），正是本迭代要消灭的「共享资源上的多余重活」。
    const childSessionId = `${sessionId}::child`;
    onCoreRunFinished({
      sessionId: childSessionId,
      projectId,
      runId: "child-run-1",
      stopReason: "completed",
    });
    onCoreRunFailed({
      sessionId: childSessionId,
      projectId,
      runId: "child-run-2",
      error: "boom",
    });
    // 等满两个防抖窗口：一次都不该排（execCount 停在 0）。
    await sleep(650);
    assert.equal(
      chatPromptTokenDebounceExecCountForTests(childSessionId),
      0,
      "子 run 终态不应触发子会话的读口补推（0 次才算过滤）",
    );
  });

  it("T-DA3: build 途中 run 起步 ⇒ 弃权回 null，且绝不进 fallback", async () => {
    const rt = await getDesktopRuntime();
    const scope = { projectId, sessionId };

    // 前提：把 build 卡在取消息那一步，等 build 跑起来之后才让 run 起步——
    // 这正是「进得去停不下」的窗口（真实时序下窗口极窄，撞不出来）。
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let listCalls = 0;
    let entered = false;
    const gatedMessages = new Proxy(rt.messages, {
      get(target, prop, receiver) {
        if (prop === "listBySession") {
          return async (...args: unknown[]) => {
            listCalls += 1;
            entered = true;
            await gate;
            return (
              target.listBySession as (...a: unknown[]) => Promise<unknown>
            )(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const gatedRt = new Proxy(rt, {
      get(target, prop, receiver) {
        if (prop === "messages") {
          return gatedMessages;
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as typeof rt;

    const pending = loadChatPromptTokenStatsResilient(gatedRt, scope);
    const waitDeadline = Date.now() + 4000;
    while (!entered && Date.now() < waitDeadline) {
      await sleep(5);
    }
    assert.ok(entered, "build 未进入取消息阶段（前提不成立，本用例无从检验）");

    const releaseRun = await registerRunInFlight(sessionId);
    release();
    try {
      const stats = await pending;
      assert.equal(stats, null, "build 途中 run 起步应弃权回 null（保留旧标签）");
      assert.equal(
        listCalls,
        1,
        "弃权后不得再走一次 build——fallback 会重跑整段装配（调用次数 2 即红）",
      );
    } finally {
      await releaseRun();
    }
  });

  it("T-DA3-ctl: 非弃权异常仍走 fallback（证明 T-DA3 的探针不是恒真）", async () => {
    const rt = await getDesktopRuntime();
    const scope = { projectId, sessionId };

    // 只让**第一次**取消息抛普通异常：主路径挂掉 → 兜底必须重跑一遍 build 并
    // 给出读数。T-DA3 断言 listCalls===1 之所以有牙齿，靠的就是这条对照。
    let listCalls = 0;
    const flakyMessages = new Proxy(rt.messages, {
      get(target, prop, receiver) {
        if (prop === "listBySession") {
          return async (...args: unknown[]) => {
            listCalls += 1;
            if (listCalls === 1) {
              throw new Error("boom (非弃权异常)");
            }
            return (
              target.listBySession as (...a: unknown[]) => Promise<unknown>
            )(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const flakyRt = new Proxy(rt, {
      get(target, prop, receiver) {
        if (prop === "messages") {
          return flakyMessages;
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as typeof rt;

    const stats = await loadChatPromptTokenStatsResilient(flakyRt, scope);
    assert.equal(listCalls, 2, "普通异常必须落进 fallback（重跑一次 build）");
    assert.ok(stats != null, "兜底应给出读数而不是 null");
    assert.equal(typeof stats.label, "string");
  });

  it("T-DA4: 渲染层收 null 必须保留旧标签（清空/占位即红）", async () => {
    const drawer = await readFile(
      new URL("../renderer/features/chat/SessionDetailDrawer.tsx", import.meta.url),
      "utf8",
    );
    // 抽屉 chip：ok 且 data 非 null 才写 state——null 落到「保留旧标签」。
    assert.match(
      drawer,
      /if \(tokens\.ok && tokens\.data != null\)/,
      "抽屉读口回 null 时必须保留旧标签（去掉 != null 会把标签清空）",
    );
    assert.doesNotMatch(
      drawer,
      /if \(tokens\.ok\) \{\s*setTokenStats\(tokens\.data\)/,
      "抽屉不该把 null 直接写进 tokenStats（旧写法会把标签清空）",
    );

    const panel = await readFile(
      new URL("../renderer/features/chat/ConversationPanel.tsx", import.meta.url),
      "utf8",
    );
    // 指标弹窗同一口径：null 不写 state（弹窗里已有的读数原样留着）。
    assert.match(
      panel,
      /if \(res\.ok && res\.data != null\) \{\s*setMetricsContextUsageLabel\(res\.data\.label\)/,
      "指标弹窗读口回 null 时必须保留旧读数",
    );
    assert.doesNotMatch(
      panel,
      /setMetricsContextUsageLabel\(res\.ok \? res\.data\.label : null\)/,
      "指标弹窗不该把 null 当成「无读数」写进 state",
    );

    // IPC 契约本身也放宽成 nullable（否则 renderer 侧的判空没有类型依据）。
    const registry = await readFile(
      new URL("../renderer/ipc/invoke-registry.ts", import.meta.url),
      "utf8",
    );
    assert.match(
      registry,
      /IpcResult<PromptChatTokenStatsResponse \| null>/,
      "ipcPromptChatTokenLabel 的返回类型应放宽为 | null",
    );
  });
});
