import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "@/errors/app-error.js";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { SessionAgentConfig } from "@/domain/chat/model/session-agent-config.js";
import {
  AgentRunResolveError,
  resolveApplicationModelIdForRun,
  resolveCurrentAgentDefinition,
  resolveCurrentAgentId,
  type AgentRunRuntimePort,
} from "@/service/agent/logic/agent-run-shared.js";
import { tCore } from "../../helpers/core-i18n.js";

const sampleDefinition: AgentDefinition = {
  name: "Test",
  prompts: { persist: [], dynamic: [] },
  model: "provider:model",
};

function makeRuntime(overrides: {
  readonly currentAgentId?: string | null;
  readonly currentModelId?: string | null;
  readonly agentIds?: string[];
  readonly getAgent?: (id: string) => Promise<AgentDefinition>;
  readonly sessionConfig?: SessionAgentConfig;
}): AgentRunRuntimePort {
  return {
    state: {
      getCurrentAgentId: async () => overrides.currentAgentId ?? null,
      getCurrentModelId: async () => overrides.currentModelId ?? null,
    },
    agentRegistry: {
      listAgentIds: async () => overrides.agentIds ?? ["fallback-agent"],
      get: async (id: string) => {
        if (overrides.getAgent != null) {
          return overrides.getAgent(id);
        }
        return sampleDefinition;
      },
    },
    sessions: {
      getSessionAgentConfig: async () =>
        overrides.sessionConfig ?? { agentId: "a1" },
    },
  };
}

describe("agent-run-shared", () => {
  it("resolveCurrentAgentId prefers state over registry fallback", async () => {
    const runtime = makeRuntime({
      currentAgentId: "from-state",
      agentIds: ["fallback-agent"],
    });
    assert.equal(await resolveCurrentAgentId(runtime), "from-state");
  });

  it("resolveCurrentAgentId falls back to first registry id", async () => {
    const runtime = makeRuntime({ currentAgentId: "", agentIds: ["a", "b"] });
    assert.equal(await resolveCurrentAgentId(runtime), "a");
  });

  it("resolveCurrentAgentDefinition throws when no agent configured", async () => {
    const runtime = makeRuntime({ currentAgentId: "", agentIds: [] });
    await assert.rejects(
      () => resolveCurrentAgentDefinition(runtime),
      (error: unknown) => error instanceof AgentRunResolveError,
    );
  });

  it("resolveCurrentAgentDefinition maps AGENT_NOT_FOUND to AgentRunResolveError", async () => {
    const runtime = makeRuntime({
      currentAgentId: "missing",
      getAgent: async () => {
        throw new AppError("AGENT_NOT_FOUND", "missing");
      },
    });
    await assert.rejects(
      () => resolveCurrentAgentDefinition(runtime),
      (error: unknown) =>
        error instanceof AgentRunResolveError &&
        (error as AgentRunResolveError).messageKey === "error.agent.not_found" &&
        (error as AgentRunResolveError).messageParams?.agent_id === "missing",
    );
  });

  it("resolveApplicationModelIdForRun uses agent model pin", async () => {
    const runtime = makeRuntime({ currentModelId: "workspace-model" });
    const result = await resolveApplicationModelIdForRun(runtime, sampleDefinition);
    assert.equal(result.savedModelId, "provider:model");
    assert.equal(result.workspaceModelId, "workspace-model");
  });

  it("resolveApplicationModelIdForRun throws when no model resolved（无 workspace 回退）", async () => {
    const runtime = makeRuntime({ currentModelId: "workspace-model" });
    const definition: AgentDefinition = { ...sampleDefinition, model: undefined };
    // sessionConfig 默认 { agentId: "a1" } 无 modelId；agent 也无 pin → 抛错
    await assert.rejects(
      () => resolveApplicationModelIdForRun(runtime, definition, "sess-1"),
      (error: unknown) => error instanceof AgentRunResolveError,
    );
  });

  it("resolveApplicationModelIdForRun 不传 sessionId 时不读 session 配置", async () => {
    const runtime = makeRuntime({
      currentModelId: "workspace-model",
      sessionConfig: { agentId: "a1", modelId: "session-model" },
    });
    const definition: AgentDefinition = { ...sampleDefinition, model: undefined };
    // 无 sessionId → 无 sessionModelId；agent 无 pin → 抛错（不再回退 workspace）
    await assert.rejects(
      () => resolveApplicationModelIdForRun(runtime, definition),
      (error: unknown) => error instanceof AgentRunResolveError,
    );
  });

  it("resolveApplicationModelIdForRun session.modelId 作为 savedModelId", async () => {
    const runtime = makeRuntime({
      currentModelId: "workspace-model",
      sessionConfig: {
        agentId: "a1",
        modelId: "session-model",
      },
    });
    const definition: AgentDefinition = { ...sampleDefinition, model: undefined };
    const result = await resolveApplicationModelIdForRun(
      runtime,
      definition,
      "sess-1",
    );
    assert.equal(result.savedModelId, "session-model");
    assert.equal(result.workspaceModelId, "workspace-model");
  });

  it("resolveApplicationModelIdForRun agent pin 压制 session 覆盖", async () => {
    const runtime = makeRuntime({
      currentModelId: "workspace-model",
      sessionConfig: {
        agentId: "a1",
        modelId: "session-model",
      },
    });
    const result = await resolveApplicationModelIdForRun(
      runtime,
      sampleDefinition, // model = "provider:model"
      "sess-1",
    );
    assert.equal(result.savedModelId, "provider:model");
  });

  it("resolveApplicationModelIdForRun session 无 modelId 且 agent 无 pin → 抛错", async () => {
    const runtime = makeRuntime({
      currentModelId: "workspace-model",
      sessionConfig: { agentId: "a1" },
    });
    const definition: AgentDefinition = { ...sampleDefinition, model: undefined };
    await assert.rejects(
      () => resolveApplicationModelIdForRun(runtime, definition, "sess-1"),
      (error: unknown) => error instanceof AgentRunResolveError,
    );
  });
});

/** 错误用户可见文案：带 messageKey 时经 tCore 渲染（G1-G3 descriptor 契约），否则回退 message。 */
function renderError(error: unknown): string {
  const e = error as {message: string; messageKey?: string; messageParams?: Record<string, unknown>};
  return textOf(error);
}

/** 含 cause 链（ToolError 包装 AppError 时 messageKey 在 cause 上）。 */
function textOf(error: unknown): string {
  const e = error as {message: string; messageKey?: string; messageParams?: Record<string, unknown>; cause?: unknown};
  if (e.messageKey != null) return tCore({key: e.messageKey as never, params: e.messageParams as never});
  if (e.cause != null && typeof e.cause === "object") return textOf(e.cause);
  return e.message;
}
