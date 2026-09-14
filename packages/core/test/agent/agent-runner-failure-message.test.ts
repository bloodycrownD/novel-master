/**
 * 失败收尾落 assistant 错误消息（run-fail-composer-lock）：
 *
 * run 失败时主 catch 在 EVENT_AGENT_RUN_FAILED 发出前落一条 assistant 错误
 * 消息——会话尾部变 assistant 后双端 composer 的连续 user 守卫
 * （lastMessageIsPlainUserText）自然解锁，错误也从一次性 toast 变为持久
 * 可回查。豁免两条：abort/cancelled（保留 partial 语义）、persistMessages
 * =false（EphemeralOverlay 不落库）；幂等防御：本轮已有 assistant 落库
 * （多步中途失败）不再追加，避免双条。
 *
 * @module test/agent/agent-runner-failure-message
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAgentRunner,
  InMemoryAgentSession,
  type AgentDefinition,
  type CreateAgentRunnerDeps,
} from "@novel-master/core/agent";
import { textBlocks } from "@novel-master/core/chat";
import {
  EVENT_AGENT_RUN_FAILED,
  SimpleEventBus,
  type AgentRunFailedPayload,
} from "@novel-master/core/events";
import {
  registerBuiltinTools,
  ToolRegistry,
  type BuiltinToolContext,
} from "@novel-master/core";
import { type LlmChatResult, type ModelRequestService } from "@novel-master/core/provider";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import { noopSavedModelRepository } from "../helpers/noop-saved-model-repo.js";
import type { VfsService } from "@novel-master/core/vfs";

const RUN_MODEL_ID = "anthropic/claude";
const MOCK_PROJECT_ID = "test-project";
const MOCK_SESSION_ID = "test-session";

function minimalDefinition(): AgentDefinition {
  return { name: "test", prompts: { persist: [], dynamic: [] } };
}

function runnerDeps(
  deps: Omit<CreateAgentRunnerDeps, "eventBus" | "sessionKkv" | "workplace" | "savedModels"> &
    Partial<Pick<CreateAgentRunnerDeps, "eventBus">>,
): CreateAgentRunnerDeps {
  return {
    savedModels: noopSavedModelRepository(),
    ...deps,
    eventBus: deps.eventBus ?? new SimpleEventBus(),
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
    async replace(path: string, oldString: string, content: string) {
      const c = files.get(path) ?? "";
      files.set(path, c.replace(oldString, content));
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

/** 首个 text 块文本；无 text 块返回 undefined。 */
function firstText(message: { content: { blocks: ReadonlyArray<{ type: string; text?: string }> } }): string | undefined {
  for (const b of message.content.blocks) {
    if (b.type === "text") {
      return b.text;
    }
  }
  return undefined;
}

describe("AgentRunner 失败收尾落 assistant 错误消息", () => {
  it("请求抛错：落 assistant 错误消息（含原始错误信息）、FAILED 事件仍发、落库先于事件、原错误仍抛出", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model: ModelRequestService = {
      request: async () => {
        throw new Error("网络连接失败");
      },
    };
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const bus = new SimpleEventBus();
    const runner = createAgentRunner(
      runnerDeps({ session, modelRequests: model, registry, toolCtx: mockToolCtx(), eventBus: bus }),
    );

    const failedPayloads: AgentRunFailedPayload[] = [];
    // FAILED 事件是同步分发的：handler 里立刻发起 session.list()，拿到的是
    // 事件发出时刻的会话快照——据此断言「错误消息落库先于事件」。
    const listAtFailed: Promise<readonly { role: string; content: { blocks: ReadonlyArray<{ type: string; text?: string }> } }>[] = [];
    bus.subscribe<AgentRunFailedPayload>(EVENT_AGENT_RUN_FAILED, (p) => {
      failedPayloads.push(p);
      listAtFailed.push(
        session.list() as Promise<never>,
      );
    });

    await assert.rejects(
      () =>
        runner.run({
          maxSteps: 3,
          definition: minimalDefinition(),
          ...defaultRunScope,
        }),
      (e: unknown) => e instanceof Error && e.message === "网络连接失败",
    );

    // FAILED 事件仍发，error 为原始错误信息
    assert.equal(failedPayloads.length, 1);
    assert.equal(failedPayloads[0]!.error, "网络连接失败");
    assert.equal(failedPayloads[0]!.sessionId, MOCK_SESSION_ID);

    // 事件发出时刻，错误 assistant 已可读（落库先于事件，下游 tail reload 能读到）
    const messagesAtFailed = await listAtFailed[0]!;
    const tailAtFailed = messagesAtFailed[messagesAtFailed.length - 1]!;
    assert.equal(tailAtFailed.role, "assistant");

    // run 结束后会话尾部：user 原文 + assistant 错误消息
    const msgs = await session.list();
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0]!.role, "user");
    const tail = msgs[1]!;
    assert.equal(tail.role, "assistant");
    assert.equal(tail.content.blocks.length, 1);
    assert.equal(tail.content.blocks[0]!.type, "text");
    assert.match(firstText(tail as never) ?? "", /^\[生成失败\] 网络连接失败$/);
  });

  it("abort 路径（catch 命中 AbortError）：不落错误消息，保持 partial 语义", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const controller = new AbortController();
    const model: ModelRequestService = {
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
      runnerDeps({ session, modelRequests: model, registry, toolCtx: mockToolCtx() }),
    );

    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
      signal: controller.signal,
    });

    assert.equal(result.stopReason, "cancelled");
    const msgs = await session.list();
    // 仅 turn 起点 user；abort 无 partial 内容可写，也无「生成失败」
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0]!.role, "user");
  });

  it("persistMessages=false（EphemeralOverlay）：失败不落库", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model: ModelRequestService = {
      request: async () => {
        throw new Error("网络连接失败");
      },
    };
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({ session, modelRequests: model, registry, toolCtx: mockToolCtx() }),
    );

    await assert.rejects(
      () =>
        runner.run({
          maxSteps: 3,
          definition: minimalDefinition(),
          ...defaultRunScope,
          persistMessages: false,
        }),
      (e: unknown) => e instanceof Error && e.message === "网络连接失败",
    );

    // base session 不增消息（overlay 只进内存，失败也不落库）
    const msgs = await session.list();
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0]!.role, "user");
  });

  it("幂等防御：多步 run 已有 assistant 落库后再失败，不追加错误消息", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    // step1 成功返回 tool_use（assistant 落库 + tool_results 回传），step2 抛错
    const responses: LlmChatResult[] = [
      {
        assistantText: "",
        blocks: [
          { type: "tool_use", id: "t1", name: "read", input: { path: "/x" } },
        ],
        raw: {},
      },
    ];
    let calls = 0;
    const model: ModelRequestService = {
      request: async () => {
        const r = responses[calls];
        calls += 1;
        if (r == null) {
          throw new Error("第二轮网络失败");
        }
        return r;
      },
    };
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({ session, modelRequests: model, registry, toolCtx: mockToolCtx() }),
    );

    await assert.rejects(
      () =>
        runner.run({
          maxSteps: 3,
          definition: minimalDefinition(),
          ...defaultRunScope,
        }),
      (e: unknown) => e instanceof Error && e.message === "第二轮网络失败",
    );

    // 会话里不应出现「生成失败」——前序 step 的 assistant 已落库，
    // 尾部为 tool_results user，isPlainUserText 已为 false、composer 本就解锁。
    const msgs = await session.list();
    assert.equal(msgs.length, 3); // user + assistant(tool_use) + user(tool_results)
    for (const m of msgs) {
      assert.equal(firstText(m as never)?.includes("生成失败") ?? false, false);
    }
  });
});
