import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import {
  AgentTurnError,
  runAgentTurn,
  type AgentTurnRuntimePort,
} from "@/service/agent/logic/run-agent-turn.js";

const sampleDefinition: AgentDefinition = {
  name: "Test",
  prompts: { persist: [], dynamic: [] },
  model: "provider:model",
};

function makeRuntime(overrides: {
  readonly listBySession?: () => Promise<
    ReadonlyArray<{ role: string; content: unknown }>
  >;
  readonly append?: () => Promise<{ id: string }>;
}): AgentTurnRuntimePort {
  return {
    state: {
      getCurrentAgentId: async () => "a1",
      getCurrentModelId: async () => "openai/gpt",
      getCurrentRegexGroupId: async () => undefined,
    },
    agentRegistry: {
      listAgentIds: async () => ["a1"],
      get: async () => sampleDefinition,
    },
    messages: {
      listBySession:
        overrides.listBySession ?? (async () => []),
      append:
        overrides.append ??
        (async () => ({ id: "m1", role: "user", content: { blocks: [] } })),
    } as AgentTurnRuntimePort["messages"],
    messageCheckpoint: {
      capture: async () => undefined,
    } as AgentTurnRuntimePort["messageCheckpoint"],
    modelRequests: {} as AgentTurnRuntimePort["modelRequests"],
    worktreeSnapshot: {
      getOrRefresh: async (_p, _s, render) => {
        const data = await render();
        return {
          worktreeDisplay: data.worktreeDisplay,
          listRows: data.listRows,
          refreshedAtMs: Date.now(),
        };
      },
    } as AgentTurnRuntimePort["worktreeSnapshot"],
    eventBus: {} as AgentTurnRuntimePort["eventBus"],
    regexConfig: {} as AgentTurnRuntimePort["regexConfig"],
    compactionConditionEvaluator:
      undefined as unknown as AgentTurnRuntimePort["compactionConditionEvaluator"],
    eventOrchestrator:
      {} as AgentTurnRuntimePort["eventOrchestrator"],
    sessionVfs: () => ({} as AgentTurnRuntimePort["sessionVfs"] extends (
      ...args: never[]
    ) => infer R
      ? R
      : never),
    worktree: () =>
      ({
        renderDisplay: async () => "",
        buildListRows: async () => [],
      }) as ReturnType<AgentTurnRuntimePort["worktree"]>,
  };
}

describe("runAgentTurn", () => {
  it("rejects empty input when resume is not allowed", async () => {
    await assert.rejects(
      () =>
        runAgentTurn(
          makeRuntime({}),
          { projectId: "p", sessionId: "s" },
          "",
        ),
      (err: unknown) => {
        assert.ok(err instanceof AgentTurnError);
        assert.equal(err.message, "消息不能为空");
        return true;
      },
    );
  });

  it("does not append user message on empty resume when last is user", async () => {
    let appended = false;
    const runtime = makeRuntime({
      listBySession: async () => [{ role: "user", content: { blocks: [] } }],
      append: async () => {
        appended = true;
        return { id: "m-new" };
      },
    });
    try {
      await runAgentTurn(
        runtime,
        { projectId: "p", sessionId: "s" },
        "",
        { allowResumeWithoutInput: true },
      );
    } catch {
      // Runner deps are stubbed; reaching runner means resume gate passed.
    }
    assert.equal(appended, false);
  });

  it("rejects empty resume when last message is not user", async () => {
    await assert.rejects(
      () =>
        runAgentTurn(
          makeRuntime({
            listBySession: async () => [
              { role: "assistant", content: { blocks: [] } },
            ],
          }),
          { projectId: "p", sessionId: "s" },
          "",
          { allowResumeWithoutInput: true },
        ),
      (err: unknown) => {
        assert.ok(err instanceof AgentTurnError);
        return true;
      },
    );
  });
});
