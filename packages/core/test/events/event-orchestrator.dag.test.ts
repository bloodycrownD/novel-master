import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type { EventsConfig } from "../../src/domain/events-config/model/events-config.js";
import { DefaultEventOrchestrator } from "../../src/service/events/impl/event-orchestrator.service.js";

describe("event orchestrator (DAG)", () => {
  it("runs dependents only after all deps succeed", async () => {
    const calls: string[] = [];

    const config: EventsConfig = {
      schemaVersion: 2,
      events: {
        "session.compaction.requested": [
          { type: "refresh-macros", params: {} },
          {
            type: "hide-message",
            params: { startDepth: 0 },
            dependency: ["refresh-macros"],
          },
        ],
      },
    };

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

    const orch = new DefaultEventOrchestrator({
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
      } as any,
      messages: {
        async listBySession() {
          return messages;
        },
      } as any,
      macroCache: {
        async refresh(_projectId, _sessionId, render) {
          calls.push("refresh-macros");
          await render();
        },
      } as any,
      worktree: () =>
        ({
          async renderDisplay() {
            return "worktree";
          },
          async renderFileTree() {
            return "filetree";
          },
        }) as any,
      createSession: () =>
        ({
          async hideRange() {
            calls.push("hide-message");
          },
        }) as any,
    });

    const result = await orch.emit("session.compaction.requested", {
      sessionId: "s1",
      projectId: "p1",
      trigger: "manual",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ["refresh-macros", "hide-message"]);
  });

  it("stops scheduling further actions after any failure", async () => {
    const calls: string[] = [];

    const config: EventsConfig = {
      schemaVersion: 2,
      events: {
        "session.compaction.requested": [
          { type: "refresh-macros", params: {} },
          {
            type: "hide-message",
            params: { startDepth: 0 },
            dependency: ["refresh-macros"],
          },
        ],
      },
    };

    const orch = new DefaultEventOrchestrator({
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
      } as any,
      messages: {
        async listBySession() {
          return [];
        },
      } as any,
      macroCache: {
        async refresh() {
          calls.push("refresh-macros");
          throw new Error("boom");
        },
      } as any,
      worktree: () => ({}) as any,
      createSession: () =>
        ({
          async hideRange() {
            calls.push("hide-message");
          },
        }) as any,
    });

    const result = await orch.emit("session.compaction.requested", {
      sessionId: "s1",
      projectId: "p1",
      trigger: "manual",
    });
    assert.equal(result.ok, false);
    assert.equal(result.partialFailure, false);
    assert.deepEqual(calls, ["refresh-macros"]);
  });
});

