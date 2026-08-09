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
import { SimpleEventBus } from "../../src/infra/events/simple-event-bus.js";
import { detachEventOrchestratorFromBus } from "../../src/service/events/create-event-orchestrator.js";
import { runRunAgentAction } from "../../src/service/events/impl/actions/run-agent.handler.js";
import {
  DefaultEventOrchestrator,
  type DefaultEventOrchestratorDeps,
} from "../../src/service/events/impl/event-orchestrator.service.js";
import type { EventRunResult } from "../../src/service/events/event-run-result.js";

async function waitForBusActions(orch: {
  pendingEmits(): Promise<void>;
}): Promise<void> {
  // 不再用 setTimeout(30) 等 fire-and-forget emit 调落：orchestrator 现在把 in-flight
  // promise 收集起来，pendingEmits 能确定性等到它们 settle。
  await orch.pendingEmits();
}

// 兼容旧入口：部分测试只需抽干 microtask 队列，不依赖 orchestrator。
async function flushMicrotasks(depth = 4): Promise<void> {
  for (let i = 0; i < depth; i++) {
    await Promise.resolve();
  }
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
    sessionKkv: {
      async get() {
        return null;
      },
      async set() {},
      async delete() {},
      async clearDomain() {},
      async clearSession() {},
      async listKeys() {
        return [];
      },
    },
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
      await waitForBusActions(orch);
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
      await waitForBusActions(orch);
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
    await waitForBusActions(orch);
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
    await waitForBusActions(orch);
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
        workplace: () =>
          ({
            scope: { kind: "session", projectId: "p1", sessionId: "s1" },
            renderDisplay: async () => "",
            buildListRows: async () => [],
            materializePersistBlock: async () => ({ workplaceDisplay: "" }),
          }) as never,
        sessionVfs: () => ({}) as never,
        messageCheckpoint: {} as never,
        sessionKkv: {} as never,
        eventBus: bus,
        getWorkspaceModelId: async () => "anthropic/claude",
      },
    );

    assert.equal(published.length, 0);
  });

  // T-SC7：sub-agent task 工具（persistMessages:true）触发时，父 run events DAG 正确门控。
  //
  // 该分支现未合入 task 工具与 `agentActiveRefCount` 装配点，能直接测的是“最接近的同类路径”——
  // 经 orchestrator DAG 走的 run-agent action：它必须仍以 publishRunLifecycle:false / persistMessages:false
  // 运行，并且不向父 bus 透走任何 AGENT_RUN_* 事件。该断言起到“门控回归保底”的作用：
  // 一旦 task 工具 / agentActiveRefCount 后续合入，这里能第一时间报警谁把门控默走了。
  it("T-SC7: run-agent 事件 action 不向父 bus 透走 AGENT_RUN_* 生命周期事件", async () => {
    const bus = new SimpleEventBus();
    const lifecycleEvents = [
      EVENT_AGENT_RUN_STARTED,
      EVENT_AGENT_RUN_FINISHED,
    ];
    const published: string[] = [];
    for (const type of lifecycleEvents) {
      bus.subscribe(type, () => published.push(type));
    }

    const config: EventsConfig = {
      schemaVersion: 2,
      events: {
        [EVENT_SESSION_MESSAGE_RECEIVED]: [
          { type: "run-agent", params: { agentId: "writer" } },
        ],
      },
    };

    let runAgentCalled = false;
    const { orch } = createOrchestrator({
      bus,
      config,
      onActionFailure: ({ result }) => {
        throw new Error(
          `DAG 应门控成功，不应上报失败: ${JSON.stringify(result.failures)}`,
        );
      },
    });
    // 注入 runAgent runtime 桩：只记录被调用、不实际跑 runner，验证 DAG 把该 action 正常走到位。
    (orch as unknown as { deps: DefaultEventOrchestratorDeps }).deps.runAgent = {
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
          runAgentCalled = true;
          return {
            assistantText: "ok",
            blocks: [{ type: "text", text: "ok" }],
            raw: {},
          };
        },
      } as never,
      workplace: () =>
        ({
          scope: { kind: "session", projectId: "p1", sessionId: "s1" },
          renderDisplay: async () => "",
          buildListRows: async () => [],
          materializePersistBlock: async () => ({ workplaceDisplay: "" }),
        }) as never,
      sessionVfs: () => ({}) as never,
      messageCheckpoint: {} as never,
      sessionKkv: {} as never,
      eventBus: bus,
      getWorkspaceModelId: async () => "anthropic/claude",
    };
    orch.attachToBus();

    bus.publish(EVENT_SESSION_MESSAGE_RECEIVED, {
      sessionId: "s1",
      projectId: "p1",
    });
    await waitForBusActions(orch);

    // 门控仍生效：父 bus 看不到任何 AGENT_RUN_* 事件；DAG 仍然推进了 run-agent。
    assert.equal(published.length, 0);
    assert.equal(runAgentCalled, true);
    orch.detachFromBus();
  });
});