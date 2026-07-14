import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type { EventsConfig } from "../../src/domain/events-config/model/events-config.js";
import { DefaultEventOrchestrator } from "../../src/service/events/impl/event-orchestrator.service.js";

function baseOrchestrator(
  config: EventsConfig,
  extras?: {
    readonly onEffectsHide?: () => void | Promise<void>;
    readonly onRunAgent?: () => void | Promise<void>;
  },
) {
  const messages: ChatMessage[] = [
    {
      id: "m1",
      sessionId: "s1",
      seq: 1,
      role: "assistant",
      content: [] as unknown as ChatMessage["content"],
      provider: null,
      raw: null,
      createdAtMs: Date.now(),
      hidden: false,
    },
  ];

  return new DefaultEventOrchestrator({
    eventsConfig: {
      async getConfig() {
        return config;
      },
      async setConfig() {},
      async clearConfig() {},
    },
    eventBus: {
      subscribe() {},
      unsubscribe() {},
      publish() {},
    } as never,
    messages: {
      async listBySession() {
        return messages;
      },
    } as never,
    messageTranscriptEffects: {
      async hideMessagesInRange(
        _projectId: string,
        _sessionId: string,
        _fromSeq: number,
        _toSeq: number,
      ) {
        await extras?.onEffectsHide?.();
        return 1;
      },
      async showMessagesInRange() {
        return 0;
      },
      async truncateMessagesAfter() {},
    } as never,
    runAgent: extras?.onRunAgent
      ? {
          messages: {} as never,
          agentRegistry: {} as never,
          modelRequests: {} as never,
          worktreeBlockStore: {} as never,
          worktree: () => ({}) as never,
          sessionVfs: () => ({}) as never,
          messageCheckpoint: {} as never,
          sessionKkv: {} as never,
          eventBus: {} as never,
          getWorkspaceModelId: async () => "m",
        }
      : undefined,
  });
}

describe("event orchestrator (DAG)", () => {
  it("hide-message 委托 effects 执行隐藏", async () => {
    let effectsHideCalled = false;
    const config: EventsConfig = {
      schemaVersion: 2,
      events: {
        "session.compaction.requested": [
          { type: "hide-message", params: { startDepth: 0 } },
        ],
      },
    };
    const orch = baseOrchestrator(config, {
      onEffectsHide: () => {
        effectsHideCalled = true;
      },
    });
    const result = await orch.emit("session.compaction.requested", {
      sessionId: "s1",
      projectId: "p1",
      trigger: "manual",
    });
    assert.equal(result.ok, true);
    assert.equal(effectsHideCalled, true);
  });

  it("returns explicit failure for unknown dependency during runtime prevalidation", async () => {
    const config: EventsConfig = {
      schemaVersion: 2,
      events: {
        "session.compaction.requested": [
          {
            type: "hide-message",
            params: { startDepth: 0 },
            dependency: ["run-agent"],
          },
        ],
      },
    };

    const orch = baseOrchestrator(config);
    const result = await orch.emit("session.compaction.requested", {
      sessionId: "s1",
      projectId: "p1",
      trigger: "manual",
    });

    assert.equal(result.ok, false);
    assert.match(result.failures[0]?.error ?? "", /unknown dependency/i);
  });

  it("returns explicit failure for cycle during runtime prevalidation", async () => {
    const config = {
      schemaVersion: 2,
      events: {
        "session.compaction.requested": [
          {
            type: "hide-message",
            params: { startDepth: 0 },
            dependency: ["run-agent"],
          },
          {
            type: "run-agent",
            params: { agentId: "writer" },
            dependency: ["hide-message"],
          },
        ],
      },
    } as EventsConfig;

    const orch = baseOrchestrator(config);
    const result = await orch.emit("session.compaction.requested", {
      sessionId: "s1",
      projectId: "p1",
      trigger: "manual",
    });

    assert.equal(result.ok, false);
    assert.match(result.failures[0]?.error ?? "", /dependency graph has a cycle/);
  });

  it("returns explicit failure for duplicate action types during runtime prevalidation", async () => {
    const config = {
      schemaVersion: 2,
      events: {
        "session.compaction.requested": [
          { type: "hide-message", params: { startDepth: 0 } },
          { type: "hide-message", params: { startDepth: 1 } },
        ],
      },
    } as EventsConfig;

    const orch = baseOrchestrator(config);
    const result = await orch.emit("session.compaction.requested", {
      sessionId: "s1",
      projectId: "p1",
      trigger: "manual",
    });

    assert.equal(result.ok, false);
    assert.equal(result.failures[0]?.actionType, "hide-message");
    assert.match(result.failures[0]?.error ?? "", /duplicate action type/i);
  });
});
