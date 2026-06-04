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
          async materialize() {
            return {
              worktreeDisplay: "worktree",
              filetreeDisplay: "filetree",
              listRows: [],
            };
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
        async refresh() {},
      } as any,
      worktree: () => ({}) as any,
      createSession: () =>
        ({
          async hideRange() {},
        }) as any,
    });

    const result = await orch.emit("session.compaction.requested", {
      sessionId: "s1",
      projectId: "p1",
      trigger: "manual",
    });

    assert.equal(result.ok, false);
    assert.equal(result.partialFailure, false);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.actionType, "hide-message");
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
            dependency: ["refresh-macros"],
          },
          {
            type: "refresh-macros",
            params: {},
            dependency: ["hide-message"],
          },
        ],
      },
    } as EventsConfig;

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
        async refresh() {},
      } as any,
      worktree: () => ({}) as any,
      createSession: () =>
        ({
          async hideRange() {},
        }) as any,
    });

    const result = await orch.emit("session.compaction.requested", {
      sessionId: "s1",
      projectId: "p1",
      trigger: "manual",
    });

    assert.equal(result.ok, false);
    assert.equal(result.partialFailure, false);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0]?.error ?? "", /cycle detected/i);
  });

  it("returns explicit failure for duplicate action types during runtime prevalidation", async () => {
    const config = {
      schemaVersion: 2,
      events: {
        "session.compaction.requested": [
          { type: "refresh-macros", params: {} },
          { type: "refresh-macros", params: {} },
        ],
      },
    } as EventsConfig;

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
        async refresh() {},
      } as any,
      worktree: () => ({}) as any,
      createSession: () =>
        ({
          async hideRange() {},
        }) as any,
    });

    const result = await orch.emit("session.compaction.requested", {
      sessionId: "s1",
      projectId: "p1",
      trigger: "manual",
    });

    assert.equal(result.ok, false);
    assert.equal(result.partialFailure, false);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.actionType, "refresh-macros");
    assert.match(result.failures[0]?.error ?? "", /duplicate action type/i);
  });
});

