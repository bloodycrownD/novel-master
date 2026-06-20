import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type { EventsConfig } from "../../src/domain/events-config/model/events-config.js";
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_SESSION_COMPACTION_REQUESTED,
  EVENT_SESSION_MESSAGE_RECEIVED,
} from "../../src/domain/events/model/event-types.js";
import { createSessionWorktreeSnapshotStore } from "../../src/service/prompt/create-session-worktree-snapshot-store.js";
import { SimpleEventBus } from "../../src/infra/events/simple-event-bus.js";
import { detachEventOrchestratorFromBus } from "../../src/service/events/create-event-orchestrator.js";
import { runRunAgentAction } from "../../src/service/events/impl/actions/run-agent.handler.js";
import {
  DefaultEventOrchestrator,
  type DefaultEventOrchestratorDeps,
} from "../../src/service/events/impl/event-orchestrator.service.js";
import type { EventRunResult } from "../../src/service/events/event-run-result.js";

async function waitForBusActions(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function withUnhandledRejectionGuard<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; rejections: unknown[] }> {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  return fn()
    .then((result) => ({ result, rejections }))
    .finally(() => {
      process.off("unhandledRejection", onRejection);
    });
}

function baseMessages(): ChatMessage[] {
  return [
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
}

function createOrchestrator(input: {
  readonly bus: SimpleEventBus;
  readonly config: EventsConfig;
  readonly onActionFailure?: DefaultEventOrchestratorDeps["onActionFailure"];
  readonly hideImpl?: () => void | Promise<void>;
}) {
  let hideCalls = 0;
  const orch = new DefaultEventOrchestrator({
    eventsConfig: {
      async getConfig() {
        return input.config;
      },
      async setConfig() {},
      async clearConfig() {},
    },
    eventBus: input.bus,
    onActionFailure: input.onActionFailure,
    messages: {
      async listBySession() {
        return baseMessages();
      },
    } as never,
    messageTranscriptEffects: {
      async hideMessagesInRange() {
        hideCalls += 1;
        await input.hideImpl?.();
        return 1;
      },
      async showMessagesInRange() {
        return 0;
      },
      async truncateMessagesAfter() {},
    } as never,
    worktreeSnapshot: { markDirty: () => undefined } as never,
    worktree: () => ({}) as never,
    createSession: () => ({}) as never,
  });
  return { orch, getHideCalls: () => hideCalls };
}

describe("event orchestrator (bus integration)", () => {
  it("T-ORCH-1: message.received failure reports via onActionFailure, no unhandledRejection", async () => {
    const bus = new SimpleEventBus();
    const reported: EventRunResult[] = [];
    const config: EventsConfig = {
      schemaVersion: 2,
      events: {
        [EVENT_SESSION_MESSAGE_RECEIVED]: [
          { type: "hide-message", params: { startDepth: 0 } },
        ],
      },
    };
    const { orch, getHideCalls } = createOrchestrator({
      bus,
      config,
      hideImpl: async () => {
        throw new Error("hide failed");
      },
      onActionFailure: ({ result }) => reported.push(result),
    });
    orch.attachToBus();

    const { rejections } = await withUnhandledRejectionGuard(async () => {
      bus.publish(EVENT_SESSION_MESSAGE_RECEIVED, {
        sessionId: "s1",
        projectId: "p1",
      });
      await waitForBusActions();
    });

    assert.equal(rejections.length, 0);
    assert.equal(reported.length, 1);
    assert.equal(reported[0]?.ok, false);
    assert.equal(getHideCalls(), 1);
    orch.detachFromBus();
  });

  it("T-ORCH-2: compaction.requested failure path is symmetric", async () => {
    const bus = new SimpleEventBus();
    const reported: EventRunResult[] = [];
    const config: EventsConfig = {
      schemaVersion: 2,
      events: {
        [EVENT_SESSION_COMPACTION_REQUESTED]: [
          { type: "hide-message", params: { startDepth: 0 } },
        ],
      },
    };
    const { orch } = createOrchestrator({
      bus,
      config,
      hideImpl: async () => {
        throw new Error("compaction hide failed");
      },
      onActionFailure: ({ result }) => reported.push(result),
    });
    orch.attachToBus();

    const { rejections } = await withUnhandledRejectionGuard(async () => {
      bus.publish(EVENT_SESSION_COMPACTION_REQUESTED, {
        sessionId: "s1",
        projectId: "p1",
        trigger: "manual",
      });
      await waitForBusActions();
    });

    assert.equal(rejections.length, 0);
    assert.equal(reported.length, 1);
    assert.equal(reported[0]?.ok, false);
    orch.detachFromBus();
  });

  it("T-ORCH-3: success path does not report failure", async () => {
    const bus = new SimpleEventBus();
    const reported: EventRunResult[] = [];
    const config: EventsConfig = {
      schemaVersion: 2,
      events: {
        [EVENT_SESSION_MESSAGE_RECEIVED]: [
          { type: "hide-message", params: { startDepth: 0 } },
        ],
      },
    };
    const { orch } = createOrchestrator({
      bus,
      config,
      onActionFailure: ({ result }) => reported.push(result),
    });
    orch.attachToBus();
    bus.publish(EVENT_SESSION_MESSAGE_RECEIVED, {
      sessionId: "s1",
      projectId: "p1",
    });
    await waitForBusActions();
    assert.equal(reported.length, 0);
    orch.detachFromBus();
  });

  it("T-DET-1: attach, detach, re-attach does not double-fire", async () => {
    const bus = new SimpleEventBus();
    const config: EventsConfig = {
      schemaVersion: 2,
      events: {
        [EVENT_SESSION_MESSAGE_RECEIVED]: [
          { type: "hide-message", params: { startDepth: 0 } },
        ],
      },
    };
    const { orch, getHideCalls } = createOrchestrator({ bus, config });
    orch.attachToBus();
    orch.attachToBus();
    detachEventOrchestratorFromBus(orch);
    orch.attachToBus();
    bus.publish(EVENT_SESSION_MESSAGE_RECEIVED, {
      sessionId: "s1",
      projectId: "p1",
    });
    await waitForBusActions();
    assert.equal(getHideCalls(), 1);
    orch.detachFromBus();
  });

  it("T-AR-2: run-agent handler does not emit lifecycle or message.received", async () => {
    const bus = new SimpleEventBus();
    const published: string[] = [];
    for (const type of [
      EVENT_SESSION_MESSAGE_RECEIVED,
      EVENT_AGENT_RUN_STARTED,
      EVENT_AGENT_RUN_FINISHED,
    ]) {
      bus.subscribe(type, () => published.push(type));
    }

    await runRunAgentAction(
      { sessionId: "s1", projectId: "p1" },
      { agentId: "writer" },
      {
        messages: {
          async listBySession() {
            return [];
          },
        } as never,
        agentRegistry: {
          async get() {
            return {
              name: "writer",
              model: "anthropic/claude",
              prompts: { persist: [], dynamic: [] },
            };
          },
        } as never,
        modelRequests: {
          async request() {
            return {
              assistantText: "ok",
              blocks: [{ type: "text", text: "ok" }],
              raw: {},
            };
          },
        } as never,
        worktreeSnapshot: createSessionWorktreeSnapshotStore(),
        worktree: () =>
          ({
            scope: { kind: "session", projectId: "p1", sessionId: "s1" },
            renderDisplay: async () => "",
            buildListRows: async () => [],
          }) as never,
        sessionVfs: () => ({}) as never,
        messageCheckpoint: {} as never,
        eventBus: bus,
        getWorkspaceModelId: async () => "anthropic/claude",
      },
    );

    assert.equal(published.length, 0);
  });
});