import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createAgentRunner,
  InMemoryAgentSession,
  type AgentDefinition,
  type CreateAgentRunnerDeps,
  type BuiltinToolContext,
} from "@novel-master/core/agent";
import { textBlocks } from "@novel-master/core/chat";
import { messageBodyText } from "@novel-master/core/prompt";
import {
  type LlmChatResult,
  type ModelRequestOptions,
  type ModelRequestService,
} from "@novel-master/core/provider";
import { SimpleEventBus } from "@novel-master/core/events";
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import { type VfsService } from "@novel-master/core/vfs";
import { noopSavedModelRepository } from "../helpers/noop-saved-model-repo.js";
import type { WorkplaceService } from "@novel-master/core/workplace";

const RUN_MODEL_ID = "anthropic/claude";
const PROJECT_ID = "p1";
const SESSION_ID = "s1";

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
    async replace() {
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

function mockToolCtx(vfs: VfsService): BuiltinToolContext {
  return {
    vfs,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    listSessionMessages: async () => [],
  };
}

/**
 * 回合快照（macro turn snapshot）：
 * dynamic 宏与 customAttach 的展开值（$time / $filetree）在 run 开始时取一次，
 * 回合内所有 step 复用同一份文本，保证每步请求是前一步的纯追加（提升前缀缓存命中）。
 */
describe("AgentRunner macro turn snapshot", () => {
  it("T-SNAP2: 多 step 内 renderFileTree 只调一次且 dynamic 块文本跨 step 一致", async () => {
    const session = new InMemoryAgentSession(SESSION_ID);
    await session.append("user", textBlocks("go"));

    const definition: AgentDefinition = {
      name: "snap-agent",
      prompts: {
        dynamicEnabled: true,
        persist: [],
        dynamic: [
          {
            name: "ctx",
            type: "text",
            role: "user",
            lifecycle: "always",
            content: "时间 {{$time}}\n树 {{$filetree}}",
          },
        ],
      },
    };

    // 每次调用返回不同内容：若某 step 走了实时渲染，跨 step 文本必然不一致。
    let renderCount = 0;
    const renderFileTree = mock.fn(async () => `/tree-call-${++renderCount}`);
    const workplace: WorkplaceService = {
      scope: { kind: "session", projectId: PROJECT_ID, sessionId: SESSION_ID },
      renderFileTree,
      renderDisplay: async () => "",
      buildListRows: async () => [],
      materializePersistBlock: async () => ({ workplaceDisplay: "" }),
      evaluateRuleView: async () => ({
        rows: [],
        displayByPath: new Map(),
      }),
    } as unknown as WorkplaceService;

    const histories: ModelRequestOptions[] = [];
    const model: ModelRequestService = {
      request: mock.fn(async (_modelId, _content, options) => {
        histories.push(options);
        if (histories.length < 2) {
          return {
            assistantText: "",
            blocks: [
              {
                type: "tool_use",
                id: "tu1",
                name: "write",
                input: { path: "/out.txt", content: "x" },
              },
            ],
            raw: {},
          } satisfies LlmChatResult;
        }
        return {
          assistantText: "ok",
          blocks: [{ type: "text", text: "ok" }],
          raw: {},
        } satisfies LlmChatResult;
      }),
    };

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner({
      savedModels: noopSavedModelRepository(),
      sessionKkv: createMemorySessionKkv(),
      eventBus: new SimpleEventBus(),
      workplace: () => workplace,
      session,
      modelRequests: model,
      registry,
      toolCtx: mockToolCtx(mockVfs()),
    } as CreateAgentRunnerDeps);

    await runner.run({
      maxSteps: 3,
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      savedModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    assert.equal(histories.length, 2);
    // 快照只取一次：customAttach/dynamic/token 计数各链路共享，不重复渲染。
    assert.equal(renderFileTree.mock.callCount(), 1);

    const dynamicBodies = histories.map((opts) => {
      const hit = (opts.history ?? []).find((m) => m.id === "prompt:ctx");
      assert.notEqual(hit, undefined, "dynamic 合成消息应存在于 history");
      return messageBodyText(hit!);
    });
    // $time 与 $filetree 均来自回合快照：跨 step 逐字一致。
    assert.equal(dynamicBodies[0], dynamicBodies[1]);
    assert.match(dynamicBodies[0]!, /\/tree-call-1/);
  });

  it("T-SNAP3: 文本不含 $filetree 时不预取（renderFileTree 零调用）", async () => {
    const session = new InMemoryAgentSession(SESSION_ID);
    await session.append("user", textBlocks("go"));

    const definition: AgentDefinition = {
      name: "snap-agent",
      prompts: {
        customAttach: "常驻提示 {{$time}}",
        dynamicEnabled: true,
        persist: [],
        dynamic: [
          {
            name: "ctx",
            type: "text",
            role: "user",
            content: "今天 {{$week_cn}}",
          },
        ],
      },
    };

    const renderFileTree = mock.fn(async () => "/tree");
    const workplace: WorkplaceService = {
      scope: { kind: "session", projectId: PROJECT_ID, sessionId: SESSION_ID },
      renderFileTree,
      renderDisplay: async () => "",
      buildListRows: async () => [],
      materializePersistBlock: async () => ({ workplaceDisplay: "" }),
      evaluateRuleView: async () => ({
        rows: [],
        displayByPath: new Map(),
      }),
    } as unknown as WorkplaceService;

    const captured: { options?: ModelRequestOptions } = {};
    const model: ModelRequestService = {
      request: mock.fn(async (_modelId, _content, options) => {
        captured.options = options;
        return {
          assistantText: "ok",
          blocks: [{ type: "text", text: "ok" }],
          raw: {},
        } satisfies LlmChatResult;
      }),
    };

    const runner = createAgentRunner({
      savedModels: noopSavedModelRepository(),
      sessionKkv: createMemorySessionKkv(),
      eventBus: new SimpleEventBus(),
      workplace: () => workplace,
      session,
      modelRequests: model,
      registry: new ToolRegistry(),
      toolCtx: mockToolCtx(mockVfs()),
    } as CreateAgentRunnerDeps);

    await runner.run({
      maxSteps: 1,
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      savedModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    // 不使用 $filetree 的 agent 不应白付一次全量 metadata 渲染。
    assert.equal(renderFileTree.mock.callCount(), 0);
    // customAttach 宏仍正常展开（extra-info 注入在最新 user 消息上）。
    const userInput = (captured.options?.history ?? []).find(
      (m) => m.role === "user" && m.id !== "prompt:ctx",
    );
    assert.notEqual(userInput, undefined);
    assert.match(messageBodyText(userInput!), /<extra-info>/);
  });
});
