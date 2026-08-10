/**
 * AgentStreamRegistry 单测 + per-step reset 集成回归。
 *
 * 覆盖：
 * - T-SR1：register 返回句柄；append / get / has 基本语义；reset 清空累积但保留句柄。
 * - T-SR2：unregister 所有权比对——不同句柄不删，相同句柄删，省略句柄直接删。
 * - T-SR3：并发 run 模拟——A register → B register 覆盖 → A unregister(A) 不删 →
 *   B unregister(B) 删（与 abortRegistry 对称）。
 * - T-SR4：多 step run 集成——step1 assistant commit 后 registry 被 reset，
 *   step2 的流式 delta 不含 step1 文本（CR-2 回归）。
 *
 * @module test/service/agent/agent-stream-registry.test
 */

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createAgentRunner,
  createAgentStreamRegistry,
  InMemoryAgentSession,
  type AgentDefinition,
} from "@novel-master/core/agent";
import { textBlocks } from "@novel-master/core/chat";
import { SimpleEventBus } from "@novel-master/core/events";
import {
  registerBuiltinTools,
  ToolRegistry,
  type BuiltinToolContext,
} from "@novel-master/core";
import {
  type LlmChatResult,
  type ModelRequestService,
} from "@novel-master/core/provider";
import { type VfsService } from "@novel-master/core/vfs";
import { createMemorySessionKkv } from "../../helpers/prompt-layout-test-helpers.js";
import { noopSavedModelRepository } from "../../helpers/noop-saved-model-repo.js";

const PROJECT_ID = "test-project";
const SESSION_ID = "test-session";
const MODEL_ID = "anthropic/claude";

function minimalDefinition(): AgentDefinition {
  return {
    name: "test",
    prompts: { persist: [], dynamic: [] },
  };
}

describe("AgentStreamRegistry 单测", () => {
  describe("T-SR1 register/reset/append/get/has 基本语义", () => {
    it("register 返回非空句柄；append 累积；get 返回快照；has 反映注册状态", () => {
      const registry = createAgentStreamRegistry();
      const handle = registry.register(SESSION_ID);
      assert.ok(typeof handle === "string" && handle.length > 0, "handle 应是非空字符串");
      assert.equal(registry.has(SESSION_ID), true);

      registry.append(SESSION_ID, { text: "hello " });
      registry.append(SESSION_ID, { text: "world", thinking: "hmm" });

      const snap = registry.get(SESSION_ID);
      assert.deepEqual(snap, { text: "hello world", thinking: "hmm" });
    });

    it("reset 清空累积文本但保留句柄——句柄不变，finally 的 unregister 仍能比对", () => {
      const registry = createAgentStreamRegistry();
      const handle = registry.register(SESSION_ID);
      registry.append(SESSION_ID, { text: "step1-text", thinking: "step1-think" });

      // step commit 后 reset
      registry.reset(SESSION_ID);

      const after = registry.get(SESSION_ID);
      assert.deepEqual(after, { text: "", thinking: "" }, "reset 后累积应清空");
      assert.equal(registry.has(SESSION_ID), true, "reset 不反注册");

      // 句柄保留：用原句柄 unregister 能成功删除
      registry.unregister(SESSION_ID, handle);
      assert.equal(registry.has(SESSION_ID), false);
    });

    it("append / reset 未注册的 sessionId 静默 no-op", () => {
      const registry = createAgentStreamRegistry();
      // 不应抛错
      registry.append("unknown", { text: "x" });
      registry.reset("unknown");
      assert.equal(registry.get("unknown"), undefined);
      assert.equal(registry.has("unknown"), false);
    });
  });

  describe("T-SR2 unregister 所有权比对", () => {
    it("不同句柄不删；相同句柄删；省略句柄直接删", () => {
      const registry = createAgentStreamRegistry();
      const h1 = registry.register(SESSION_ID);
      registry.append(SESSION_ID, { text: "first" });

      // 省略句柄：兼容路径，直接删
      registry.unregister(SESSION_ID);
      assert.equal(registry.has(SESSION_ID), false);

      // 重新注册拿新句柄
      const h2 = registry.register(SESSION_ID);
      assert.notEqual(h1, h2, "新 register 应签发新句柄");

      // 用旧句柄反注册：所有权比对不成立，不删
      registry.unregister(SESSION_ID, h1);
      assert.equal(registry.has(SESSION_ID), true, "旧句柄不应删新记录");

      // 用当前句柄反注册：删除
      registry.unregister(SESSION_ID, h2);
      assert.equal(registry.has(SESSION_ID), false);
    });

    it("unregister 未注册的 sessionId 静默 no-op（带或不带句柄）", () => {
      const registry = createAgentStreamRegistry();
      registry.unregister("unknown");
      registry.unregister("unknown", "any-handle");
      assert.equal(registry.has("unknown"), false);
    });
  });

  describe("T-SR3 并发 run 所有权隔离", () => {
    it("A register → B register 覆盖 → A finally unregister(A) 不删 B → B unregister(B) 删", () => {
      const registry = createAgentStreamRegistry();

      // run A 启动
      const handleA = registry.register(SESSION_ID);
      registry.append(SESSION_ID, { text: "A-partial" });

      // run B 覆盖（A 还没走完 finally，比如 abort 后异步清理滞后）
      const handleB = registry.register(SESSION_ID);
      assert.notEqual(handleA, handleB);
      registry.append(SESSION_ID, { text: "B-partial" });

      // A 的 finally 晚于 B 的 register：不应误删 B
      registry.unregister(SESSION_ID, handleA);
      assert.equal(registry.has(SESSION_ID), true, "A 不应删 B");
      const snap = registry.get(SESSION_ID);
      assert.equal(snap?.text, "B-partial", "B 的累积应保留");

      // B 的 finally 正常清理
      registry.unregister(SESSION_ID, handleB);
      assert.equal(registry.has(SESSION_ID), false);
    });

    it("step reset 后 run 边界的句柄仍所有权有效（CR-2 与 CR-7 协同）", () => {
      // 模拟：run A 内部经历了多次 step reset，但 finally 用的仍是 register 返回的句柄。
      const registry = createAgentStreamRegistry();
      const handleA = registry.register(SESSION_ID);
      registry.append(SESSION_ID, { text: "step1" });
      registry.reset(SESSION_ID);
      registry.append(SESSION_ID, { text: "step2" });
      registry.reset(SESSION_ID);

      // 此时若并发 run B 覆盖
      const handleB = registry.register(SESSION_ID);

      // A 的 finally 用 handleA：不删 B
      registry.unregister(SESSION_ID, handleA);
      assert.equal(registry.has(SESSION_ID), true);

      // B 的 finally 用 handleB：删
      registry.unregister(SESSION_ID, handleB);
      assert.equal(registry.has(SESSION_ID), false);
    });
  });
});

// ---------------------------------------------------------------------------
// 集成测试：跑真实 runner.run 两个 step，验证 step commit 后 registry reset。
// ---------------------------------------------------------------------------

function mockVfs(): VfsService {
  const files = new Map<string, string>();
  return {
    async read(path: string) {
      return { path, content: files.get(path) ?? "", version: 1, mtimeMs: 0 };
    },
    async write(path: string, content: string) {
      files.set(path, content);
      return { version: 1 };
    },
    async replace(path: string, oldString: string, newString: string) {
      const c = files.get(path) ?? "";
      files.set(path, c.replace(oldString, newString));
      return { version: 1, replacements: 1 };
    },
    async list() {
      return [...files.keys()];
    },
    async glob() {
      return [];
    },
    async grep() {
      return [];
    },
    async delete() {
      return { deleted: true };
    },
  } as unknown as VfsService;
}

function mockToolCtx(
  vfs: VfsService,
  sessionKkv: ReturnType<typeof createMemorySessionKkv>,
): BuiltinToolContext {
  return {
    vfs,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    listSessionMessages: async () => [],
    sessionKkv,
  };
}

function scriptedModel(
  responses: LlmChatResult[],
  hooks: {
    onStreamDelta?: (callIdx: number, ev: { type: "text-delta"; text: string }) => void;
    onRequestStart?: (callIdx: number) => void;
  } = {},
): ModelRequestService & { callCount: () => number } {
  let calls = 0;
  return {
    callCount: () => calls,
    request: mock.fn(async () => {
      const idx = calls;
      hooks.onRequestStart?.(idx);
      const r = responses[calls];
      calls += 1;
      if (r == null) {
        throw new Error("Unexpected extra model request");
      }
      // 模拟流式输出：每条响应先把 assistantText 拆成 delta 推给 onStream
      if (hooks.onStreamDelta != null && typeof r.assistantText === "string") {
        for (const ch of r.assistantText) {
          hooks.onStreamDelta(idx, { type: "text-delta", text: ch });
        }
      }
      return r;
    }),
  };
}

describe("AgentStreamRegistry per-step reset 集成（CR-2）", () => {
  it("T-SR4：多 step run，step1 commit 后 registry 被重置，step2 delta 不含 step1 文本", async () => {
    const session = new InMemoryAgentSession(SESSION_ID, SESSION_ID);
    await session.append("user", textBlocks("go"));

    const sessionKkv = createMemorySessionKkv();
    await sessionKkv.set(SESSION_ID, "rule_snapshot", "canon", "[]");

    const vfs = mockVfs();
    const streamRegistry = createAgentStreamRegistry();
    // run 边界 register（同 run-agent-turn 入口）
    const handle = streamRegistry.register(SESSION_ID);

    // step1：带 tool_use 的 assistant（触发 step commit + reset，然后继续 step2）
    // step2：纯 text 收尾（finished）
    const model = scriptedModel(
      [
        {
          assistantText: "STEP1",
          blocks: [
            { type: "text", text: "STEP1" },
            {
              type: "tool_use",
              id: "t1",
              name: "write",
              input: { path: "/a.txt", content: "x" },
            },
          ],
          raw: {},
        },
        {
          assistantText: "STEP2",
          blocks: [{ type: "text", text: "STEP2" }],
          raw: {},
        },
      ],
      {
        // 把流式 delta 转发进 streamRegistry（同 wrapStreamForBus 的 append 路径）
        onStreamDelta: (_idx, ev) => {
          streamRegistry.append(SESSION_ID, { text: ev.text });
        },
        onRequestStart: (idx) => {
          if (idx === 1) {
            // step2 request 开始时，step1 已 commit + reset。
            // 若 per-step reset 缺失，这里会拿到 "STEP1"。
            const atStep2Start = streamRegistry.get(SESSION_ID);
            assert.equal(
              atStep2Start?.text ?? "",
              "",
              `step2 开始时 registry 应被 step1 commit 重置为空，实际=${JSON.stringify(atStep2Start?.text)}（含 STEP1 说明 reset 没生效）`,
            );
          }
        },
      },
    );

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = createAgentRunner({
      session,
      modelRequests: model,
      registry,
      toolCtx: mockToolCtx(vfs, sessionKkv),
      eventBus: new SimpleEventBus(),
      sessionKkv,
      savedModels: noopSavedModelRepository(),
      streamRegistry,
      workplace: () =>
        ({
          scope: {
            kind: "session",
            projectId: PROJECT_ID,
            sessionId: SESSION_ID,
          },
          renderDisplay: async () => "WT",
          buildListRows: async () => [],
          materializePersistBlock: async () => ({ workplaceDisplay: "" }),
        }) as never,
    });

    await runner.run({
      maxSteps: 5,
      definition: minimalDefinition(),
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      savedModelId: MODEL_ID,
      workspaceModelId: MODEL_ID,
      stream: true,
      // 默认 publishRunLifecycle=true，step commit 会触发 streamRegistry.reset
    });

    // step1 commit 后 registry 被 reset；step2 开始时已断言 registry 为空。
    // step2 也 commit + reset，所以 run 结束后 partial 最终为空（最后一步的 assistant
    // 也已落库）。这里断言「最终为空」锁定：reset 对每一步都生效，不会累积历史 step。
    const final = streamRegistry.get(SESSION_ID);
    assert.ok(final != null, "run 期间 registry 应仍注册");
    assert.equal(
      final.text,
      "",
      `run 结束后 partial 应为空（最后一步也 commit+reset），实际=${JSON.stringify(final.text)}`,
    );

    // run 边界 unregister 带句柄比对：原句柄仍有效（step reset 没换句柄）
    streamRegistry.unregister(SESSION_ID, handle);
    assert.equal(streamRegistry.has(SESSION_ID), false, "run 结束 unregister 应移除条目");
    assert.equal(model.callCount(), 2, "应跑两个 model step");
  });
});
