import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createAgentRunner,
  InMemoryAgentSession,
  messageBodyText,
  textBlocks,
  SimpleEventBus,
  ToolRegistry,
  type AgentDefinition,
  type CreateAgentRunnerDeps,
  type LlmChatResult,
  type ModelRequestOptions,
  type ModelRequestService,
  type SessionMacroCache,
} from "@novel-master/core";

const RUN_MODEL_ID = "anthropic/claude";
const PROJECT_ID = "p1";
const SESSION_ID = "s1";

function mockMacroCache(worktreeDisplay: string): SessionMacroCache {
  const snapshot = {
    worktreeDisplay,
    filetreeDisplay: "",
    listRows: [],
    refreshedAtMs: 0,
  };
  return {
    get: (projectId, sessionId) =>
      projectId === PROJECT_ID && sessionId === SESSION_ID ? snapshot : undefined,
    refresh: async () => snapshot,
    clear: () => undefined,
  };
}

function runnerDeps(
  deps: Omit<CreateAgentRunnerDeps, "eventBus" | "macroCache">,
  macroCache: SessionMacroCache,
): CreateAgentRunnerDeps {
  return {
    ...deps,
    eventBus: new SimpleEventBus(),
    macroCache,
  };
}

describe("AgentRunner template blocks", () => {
  it("T5: history includes synthetic user message from template block", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const definition: AgentDefinition = {
      name: "ctx-agent",
      prompts: [
        { name: "ctx", type: "text", role: "user", content: "{{.worktree}}" },
        { name: "c", type: "chat" },
      ],
    };

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

    const runner = createAgentRunner(
      runnerDeps(
        {
          session,
          modelRequests: model,
          registry: new ToolRegistry(),
          toolCtx: {} as CreateAgentRunnerDeps["toolCtx"],
        },
        mockMacroCache("WORKTREE_SNAPSHOT"),
      ),
    );

    await runner.run({
      maxSteps: 1,
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    const history = captured.options?.history ?? [];
    assert.equal(history.length, 2);
    assert.equal(history[0]!.id, "prompt:ctx");
    assert.equal(messageBodyText(history[0]!), "WORKTREE_SNAPSHOT");
    assert.equal(history[1]!.role, "user");
  });
});
