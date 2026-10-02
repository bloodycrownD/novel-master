import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAgentRunner,
  InMemoryAgentSession,
  type AgentDefinition,
  type BuiltinToolContext,
  type CreateAgentRunnerDeps,
} from "@novel-master/core/agent";
import { textBlocks } from "@novel-master/core/chat";
import { messageBodyText } from "@novel-master/core/prompt";
import { type LlmChatResult, type ModelRequestOptions, type ModelRequestService } from "@novel-master/core/provider";
import { SimpleEventBus } from "@novel-master/core/events";
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import { type VfsService } from "@novel-master/core/vfs";

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

function mockToolCtx(vfs: VfsService): BuiltinToolContext {
  return {
    vfs,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
  };
}

import { noopSavedModelRepository } from "../helpers/noop-saved-model-repo.js";

function runnerDeps(
  deps: Omit<CreateAgentRunnerDeps, "eventBus" | "sessionKkv" | "workplace" | "savedModels"> &
    Partial<Pick<CreateAgentRunnerDeps, "savedModels">>,
): CreateAgentRunnerDeps {
  return {
    savedModels: noopSavedModelRepository(),
    ...deps,
    eventBus: new SimpleEventBus(),
    sessionKkv: createMemorySessionKkv(),
    workplace: () =>
      ({
        scope: { kind: "session", projectId: PROJECT_ID, sessionId: SESSION_ID },
        renderDisplay: async () => "",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ workplaceDisplay: "" }),
      }) as never,
  };
}

describe("AgentRunner dynamic 区 once 语义", () => {
  it("R1: dynamic block only on step 0 history", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const definition: AgentDefinition = {
      name: "kick-agent",
      prompts: {
        persist: [],
        dynamicEnabled: true,
        dynamic: [
          { name: "kick", type: "text", role: "user", content: "继续" },
        ],
      },
    };

    const captured: ModelRequestOptions[] = [];
    const model: ModelRequestService = {
      async request(_id, _prompt, options) {
        captured.push(options);
        const step = captured.length - 1;
        if (step === 0) {
          return {
            assistantText: "",
            blocks: [
              {
                type: "tool_use",
                id: "t1",
                name: "read",
                input: { path: "/x" },
              },
            ],
            raw: {},
          } satisfies LlmChatResult;
        }
        return {
          assistantText: "done",
          blocks: [{ type: "text", text: "done" }],
          raw: {},
        } satisfies LlmChatResult;
      },
    };

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(mockVfs()),
      }),
    );

    await runner.run({
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      savedModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
      maxSteps: 3,
    });

    assert.equal(captured.length, 2);
    const step0Kick = captured[0]!.history.find((m) => m.id === "prompt:kick");
    assert.ok(step0Kick);
    const step1Kick = captured[1]!.history.find((m) => m.id === "prompt:kick");
    assert.equal(step1Kick, undefined);
  });

  it("R2: 跨轮新 run 的 step 0 重新注入 dynamic 块", async () => {
    const definition: AgentDefinition = {
      name: "again-agent",
      prompts: {
        persist: [],
        dynamicEnabled: true,
        dynamic: [
          { name: "ctx", type: "text", role: "user", content: "prefix" },
        ],
      },
    };

    const captured: ModelRequestOptions[] = [];
    const model: ModelRequestService = {
      async request(_id, _prompt, options) {
        captured.push(options);
        if (captured.length % 2 === 1) {
          return {
            assistantText: "",
            blocks: [
              {
                type: "tool_use",
                id: "t1",
                name: "read",
                input: { path: "/x" },
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
      },
    };

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const makeRunner = (session: InMemoryAgentSession) =>
      createAgentRunner(
        runnerDeps({
          session,
          modelRequests: model,
          registry,
          toolCtx: mockToolCtx(mockVfs()),
        }),
      );

    // 第一轮 run：step0 注入、step1 跳过
    const session1 = new InMemoryAgentSession();
    await session1.append("user", textBlocks("go"));
    await makeRunner(session1).run({
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      savedModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
      maxSteps: 3,
    });
    assert.ok(captured[0]!.history.some((m) => m.id === "prompt:ctx"));
    assert.ok(
      !captured[1]!.history.some((m) => m.id === "prompt:ctx"),
      "step1 不应重复注入 dynamic 块"
    );

    // 第二轮新 run（同一 session 续接）：step0 重新注入
    await session1.append("user", textBlocks("go again"));
    await makeRunner(session1).run({
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      savedModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
      maxSteps: 3,
    });
    assert.ok(
      captured[2]!.history.some((m) => m.id === "prompt:ctx"),
      "新 run 的 step0 应重新注入 dynamic 块"
    );
    assert.ok(
      !captured[3]!.history.some((m) => m.id === "prompt:ctx"),
      "新 run 的 step1 仍不应注入"
    );
  });

  it("R3: system 来自 layout.system 字段", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const definition: AgentDefinition = {
      name: "sys-agent",
      prompts: {
        system: "你是助手",
        persist: [],
        dynamic: [],
      },
    };

    let systemArg: string | undefined;
    const model: ModelRequestService = {
      async request(_id, _prompt, options) {
        systemArg = options.system;
        return {
          assistantText: "ok",
          blocks: [{ type: "text", text: "ok" }],
          raw: {},
        } satisfies LlmChatResult;
      },
    };

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(mockVfs()),
      }),
    );

    await runner.run({
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      savedModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    assert.equal(systemArg, "你是助手");
  });
});
