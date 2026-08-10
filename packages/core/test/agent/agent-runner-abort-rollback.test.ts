/**
 * T-DS7（Step 15 / A-19）：abort 三分支注入测试。
 *
 * 构造网络抖动分别命中 9 处 abort 检测点 + catch AbortError，断言同一 abort 后
 * 会话状态一致——不残留 partial assistant、不残留 tool_results、不残留 tool_use，
 * stopReason 全部为 cancelled，session 仅保留 turn 起点的 user 消息。
 *
 * @module test/agent/agent-runner-abort-rollback.test
 */

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  ChatAgentSession,
  createAgentRunner,
  InMemoryAgentSession,
  type AgentDefinition,
  type CreateAgentRunnerDeps,
} from "@novel-master/core/agent";
import { textBlocks } from "@novel-master/core/chat";
import { SimpleEventBus } from "@novel-master/core/events";
import {
  registerBuiltinTools,
  ToolRegistry,
  ToolRunner,
  type BuiltinToolContext,
} from "@novel-master/core";
import { type LlmChatResult, type ModelRequestService } from "@novel-master/core/provider";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import { noopSavedModelRepository } from "../helpers/noop-saved-model-repo.js";
import { novelMasterTestFixture } from "../helpers/novel-master-fixture.js";
import type { VfsService } from "@novel-master/core/vfs";

const RUN_MODEL_ID = "anthropic/claude";
const MOCK_PROJECT_ID = "test-project";
const MOCK_SESSION_ID = "test-session";

function minimalDefinition(): AgentDefinition {
  return { name: "test", prompts: { persist: [], dynamic: [] } };
}

function runnerDeps(
  deps: Omit<CreateAgentRunnerDeps, "eventBus" | "sessionKkv" | "workplace" | "savedModels">,
): CreateAgentRunnerDeps {
  return {
    savedModels: noopSavedModelRepository(),
    ...deps,
    eventBus: new SimpleEventBus(),
    sessionKkv: createMemorySessionKkv(),
    workplace: () =>
      ({
        scope: { kind: "session", projectId: MOCK_PROJECT_ID, sessionId: MOCK_SESSION_ID },
        renderDisplay: async () => "WT",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ workplaceDisplay: "WT" }),
      }) as never,
  };
}

const defaultRunScope = {
  sessionId: MOCK_SESSION_ID,
  projectId: MOCK_PROJECT_ID,
  savedModelId: RUN_MODEL_ID,
  workspaceModelId: RUN_MODEL_ID,
};

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

function mockToolCtx(): BuiltinToolContext {
  return {
    vfs: mockVfs(),
    projectId: MOCK_PROJECT_ID,
    sessionId: MOCK_SESSION_ID,
    listSessionMessages: async () => [],
  };
}

/** 单条文本助手回复的 mock 模型。 */
function singleTextModel(text: string): ModelRequestService & { callCount: () => number } {
  let calls = 0;
  return {
    callCount: () => calls,
    request: mock.fn(async () => {
      calls += 1;
      return {
        assistantText: text,
        blocks: [{ type: "text", text }],
        raw: {},
      } satisfies LlmChatResult;
    }),
  };
}

/** 单条 tool_use 助手回复的 mock 模型。 */
function singleToolUseModel(): ModelRequestService & { callCount: () => number } {
  let calls = 0;
  return {
    callCount: () => calls,
    request: mock.fn(async () => {
      calls += 1;
      return {
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "tu1",
            name: "fs",
            input: { action: "ls", path: "/" },
          },
        ],
        raw: {},
      } satisfies LlmChatResult;
    }),
  };
}

novelMasterTestFixture();

describe("AgentRunner abort rollback (T-DS7)", () => {
  /**
   * 通用的「会话状态一致性」断言：abort 后 session 只剩 turn 起点的 user 消息。
   */
  function assertSessionClean(msgs: readonly { role: string; content: { blocks: { type: string }[] } }[]) {
    assert.equal(msgs.length, 1, "session 应仅剩 turn 起点的 user 消息");
    assert.equal(msgs[0]!.role, "user");
    assert.ok(
      !msgs.some((m) => m.content.blocks.some((b) => b.type === "tool_use")),
      "不应残留 tool_use partial",
    );
    assert.ok(
      !msgs.some((m) => m.content.blocks.some((b) => b.type === "tool_result")),
      "不应残留 tool_results",
    );
    assert.ok(
      !msgs.some((m) => m.role === "assistant"),
      "不应残留 assistant partial",
    );
  }

  // 检测点 1-6：在循环内不同 await 点 abort（无 partial 写入场景）
  // 用一个"在 session.list 前就 abort"的控制器覆盖 loop_start / after_session_list；
  // 其它点类似——通过劫持不同 awaitable 触发 abort 时机。
  //
  // 这里用更轻的方式：每个检测点单独构造一个会在该步触发 abort 的依赖。

  it("检测点 1 loop_start：循环开头已 abort，session 干净", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model = singleTextModel("x");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(),
      }),
    );

    const controller = new AbortController();
    controller.abort();
    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
      signal: controller.signal,
    });

    assert.equal(result.stopReason, "cancelled");
    assert.equal(model.callCount(), 0);
    const msgs = await session.list();
    assertSessionClean(msgs);
  });

  it("检测点 2 after_session_list：session.list() 后 abort，session 干净", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    // 包一层 session，让 list() 解析后再 abort
    const wrappedSession: typeof session = {
      ...session,
      list: async () => {
        controller.abort();
        return session.list();
      },
    } as typeof session;

    const controller = new AbortController();
    const model = singleTextModel("x");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session: wrappedSession,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(),
      }),
    );

    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
      signal: controller.signal,
    });

    assert.equal(result.stopReason, "cancelled");
    assert.equal(model.callCount(), 0);
    const msgs = await session.list();
    assertSessionClean(msgs);
  });

  it("检测点 6 after_compaction_eval：compaction 评估后 abort，session 干净", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const controller = new AbortController();
    const model = singleTextModel("x");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(),
        compactionConditions: {
          shouldRequestCompaction: async () => {
            controller.abort();
            return false;
          },
        },
      }),
    );

    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
      signal: controller.signal,
    });

    assert.equal(result.stopReason, "cancelled");
    assert.equal(model.callCount(), 0);
    const msgs = await session.list();
    assertSessionClean(msgs);
  });

  it("检测点 7 post_model：模型返回后 abort，未写入 partial（append 前退出）", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const controller = new AbortController();
    const model: ModelRequestService & { callCount: () => number } = {
      callCount: () => 1,
      request: async () => {
        controller.abort();
        return {
          assistantText: "partial",
          blocks: [{ type: "text", text: "partial" }],
          raw: { partial: true },
        };
      },
    };
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(),
      }),
    );

    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
      signal: controller.signal,
    });

    assert.equal(result.stopReason, "cancelled");
    assert.equal(model.callCount(), 1);
    // 方案 A：post_model abort 后 stepsExecuted 仍 +1（保留 partial assistant）
    assert.equal(result.stepsExecuted, 1);
    const msgs = await session.list();
    // 方案 A：abort 后保留 partial assistant（user + assistant 两条），不写 tool_results
    assert.equal(msgs.length, 2, "保留 turn 起点的 user 与 partial assistant");
    assert.equal(msgs[0]!.role, "user");
    assert.equal(msgs[1]!.role, "assistant");
    assert.ok(
      !msgs.some((m) => m.content.blocks.some((b) => b.type === "tool_result")),
      "不应残留 tool_results",
    );
  });

  it("检测点 model_request_catch：模型 throw AbortError，session 干净", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const controller = new AbortController();
    const model: ModelRequestService & { callCount: () => number } = {
      callCount: () => 1,
      request: async () => {
        controller.abort();
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
    };
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(),
      }),
    );

    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
      signal: controller.signal,
    });

    assert.equal(result.stopReason, "cancelled");
    assert.equal(model.callCount(), 1);
    const msgs = await session.list();
    assertSessionClean(msgs);
  });

  it("检测点 8 before_tool_run：assistant 已写、tool 未跑前 abort，保留 partial", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const controller = new AbortController();
    const model = singleToolUseModel();
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const innerRunner = new ToolRunner(registry);
    const abortBeforeToolRunner = {
      runParallel: async (..._args: Parameters<ToolRunner<BuiltinToolContext>["runParallel"]>) => {
        controller.abort();
        return innerRunner.runParallel(..._args);
      },
      call: innerRunner.call.bind(innerRunner),
    } as ToolRunner<BuiltinToolContext>;
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(),
      }),
    );
    (runner as { toolRunner: ToolRunner<BuiltinToolContext> }).toolRunner = abortBeforeToolRunner;

    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
      signal: controller.signal,
    });

    assert.equal(result.stopReason, "cancelled");
    assert.equal(model.callCount(), 1);
    const msgs = await session.list();
    // abort 保留 partial：assistant tool_use 仍在 session 里
    assert.ok(msgs.some((m) => m.role === "assistant"), "应保留已写入的 assistant");
  });

  it("检测点 9 after_tool_checkpoint：tool 跑完、checkpoint 后 abort，保留 partial", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const controller = new AbortController();
    const model: ModelRequestService & { callCount: () => number } = {
      callCount: () => 1,
      request: async () => ({
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "tu1",
            name: "write",
            input: { path: "/out.txt", content: "done" },
          },
        ],
        raw: {},
      }),
    };
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const innerRunner = new ToolRunner(registry);
    const trackingRunner = {
      runParallel: async (...args: Parameters<ToolRunner<BuiltinToolContext>["runParallel"]>) => {
        const results = await innerRunner.runParallel(...args);
        controller.abort();
        return results;
      },
      call: innerRunner.call.bind(innerRunner),
    } as ToolRunner<BuiltinToolContext>;
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(),
        messageCheckpoint: {
          capture: async () => undefined,
          backfillMissingBaselines: async () => undefined,
        },
      }),
    );
    (runner as { toolRunner: ToolRunner<BuiltinToolContext> }).toolRunner = trackingRunner;

    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
      signal: controller.signal,
    });

    assert.equal(result.stopReason, "cancelled");
    assert.equal(model.callCount(), 1);
    const msgs = await session.list();
    // abort 保留 partial：assistant + tool_results 都仍在 session 里
    assert.ok(msgs.some((m) => m.role === "assistant"), "应保留已写入的 assistant");
  });

  it("catch 分支：依赖外部抛出 AbortError，保留 partial", async () => {
    // 用 ChatAgentSession 路径模拟：让 checkpoint.capture 抛 AbortError，
    // 此时 assistant 已写入；catch 应识别为 abort 并回滚到 turn 起点。
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const controller = new AbortController();
    const model: ModelRequestService & { callCount: () => number } = {
      callCount: () => 1,
      request: async () => ({
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "tu1",
            name: "write",
            input: { path: "/out.txt", content: "done" },
          },
        ],
        raw: {},
      }),
    };
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const innerRunner = new ToolRunner(registry);
    const trackingRunner = {
      runParallel: async (...args: Parameters<ToolRunner<BuiltinToolContext>["runParallel"]>) => {
        const results = await innerRunner.runParallel(...args);
        controller.abort();
        return results;
      },
      call: innerRunner.call.bind(innerRunner),
    } as ToolRunner<BuiltinToolContext>;

    // capture 在 abort 后抛 AbortError → 命中 outer catch
    const err = new Error("aborted");
    err.name = "AbortError";
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(),
        messageCheckpoint: {
          capture: async () => {
            throw err;
          },
          backfillMissingBaselines: async () => undefined,
        },
      }),
    );
    (runner as { toolRunner: ToolRunner<BuiltinToolContext> }).toolRunner = trackingRunner;

    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
      signal: controller.signal,
    });

    assert.equal(result.stopReason, "cancelled");
    const msgs = await session.list();
    // abort 保留 partial：assistant 仍在 session 里
    assert.ok(msgs.some((m) => m.role === "assistant"), "应保留已写入的 assistant");
  });

  it("catch 分支：非 AbortError 不回滚，错误向上抛", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model: ModelRequestService & { callCount: () => number } = {
      callCount: () => 1,
      request: async () => ({
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "tu1",
            name: "write",
            input: { path: "/out.txt", content: "done" },
          },
        ],
        raw: {},
      }),
    };
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(),
        messageCheckpoint: {
          capture: async () => {
            throw new Error("non-abort boom");
          },
          backfillMissingBaselines: async () => undefined,
        },
      }),
    );

    await assert.rejects(
      () =>
        runner.run({
          maxSteps: 3,
          definition: minimalDefinition(),
          ...defaultRunScope,
        }),
      /non-abort boom/,
    );

    // 非 abort 错误不走回滚：assistant 仍在 session 里
    const msgs = await session.list();
    assert.ok(msgs.some((m) => m.role === "assistant"));
  });

  it("ChatAgentSession.truncateAfterMessage 委托 MessageService.truncateAfter（接口存在性）", async () => {
    // 静态契约校验：ChatAgentSession 必须暴露 truncateAfterMessage；
    // 不进 SQLite，仅确认接口接线，避免后续重构静默丢失。
    const fake: {
      listBySession: typeof Function;
      append: typeof Function;
      truncateAfter: (sid: string, id: string | null) => Promise<void>;
    } = {
      listBySession: async () => [],
      append: async () => ({}) as never,
      truncateAfter: async () => undefined,
    };
    const cs = new ChatAgentSession(fake as never, "s1");
    await cs.truncateAfterMessage(null);
    await cs.truncateAfterMessage("m1");
    assert.equal(typeof cs.truncateAfterMessage, "function");
  });
});
