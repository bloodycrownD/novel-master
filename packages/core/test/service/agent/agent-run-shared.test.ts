import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentConfigError } from "@/errors/agent-config-errors.js";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import {
  AgentRunResolveError,
  resolveApplicationModelIdForRun,
  resolveCurrentAgentDefinition,
  resolveCurrentAgentId,
  type AgentRunRuntimePort,
} from "@/service/agent/logic/agent-run-shared.js";

const sampleDefinition: AgentDefinition = {
  name: "Test",
  prompts: [],
  model: "provider:model",
};

function makeRuntime(overrides: {
  readonly currentAgentId?: string | null;
  readonly currentModelId?: string | null;
  readonly agentIds?: string[];
  readonly getAgent?: (id: string) => Promise<AgentDefinition>;
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
        throw new AgentConfigError("AGENT_NOT_FOUND", "missing");
      },
    });
    await assert.rejects(
      () => resolveCurrentAgentDefinition(runtime),
      (error: unknown) =>
        error instanceof AgentRunResolveError &&
        (error as AgentRunResolveError).message.includes("missing"),
    );
  });

  it("resolveApplicationModelIdForRun uses agent model pin", async () => {
    const runtime = makeRuntime({ currentModelId: "workspace-model" });
    const result = await resolveApplicationModelIdForRun(runtime, sampleDefinition);
    assert.equal(result.applicationModelId, "provider:model");
    assert.equal(result.workspaceModelId, "workspace-model");
  });

  it("resolveApplicationModelIdForRun throws when no model resolved", async () => {
    const runtime = makeRuntime({ currentModelId: "" });
    const definition: AgentDefinition = { ...sampleDefinition, model: undefined };
    await assert.rejects(
      () => resolveApplicationModelIdForRun(runtime, definition),
      (error: unknown) => error instanceof AgentRunResolveError,
    );
  });
});
