/**
 * T-AR1：条件压缩段触发时调 runCompaction（不再调 eventOrchestrator.emit）。
 *
 * 独立成文件的原因：要用 `mock.module` 把 `runCompaction` 替换成 spy，
 * 必须在 import agent-runner 之前执行 mock 注册，参照
 * `user-ops-operation-log-no-diff-hotpath.test.ts` 的范式。
 *
 * 断言口径（对齐 SPEC L272 / Step 4）：
 * 1. `runCompaction` 被调用一次；
 * 2. 收到的 `hideStartDepth` 与 evaluator.getHideStartDepth() 一致；
 * 3. CreateAgentRunnerDeps 已无 eventOrchestrator 字段，run 正常完成即说明
 *    agent-runner 不再经事件编排器走压缩路径。
 */
import assert from "node:assert/strict";
import { after, describe, it, mock } from "node:test";
import type { MessageService } from "../../src/service/chat/message.port.js";
import type { MessageTranscriptEffectsService } from "../../src/service/chat/message-transcript-effects.port.js";
import type {
  AgentDefinition,
  CreateAgentRunnerDeps,
} from "@novel-master/core/agent";
import type { BuiltinToolContext } from "@novel-master/core";
import type { LlmChatResult, ModelRequestService } from "@novel-master/core/provider";
import type { VfsService } from "@novel-master/core/vfs";

/** 捕获 runCompaction 调用参数，供断言。 */
const runCompactionCalls: Array<{
  deps: unknown;
  params: { sessionId: unknown; projectId: unknown; hideStartDepth?: unknown };
}> = [];

const runCompactionMock = mock.fn(
  async (
    _deps: unknown,
    params: {
      sessionId: unknown;
      projectId: unknown;
      hideStartDepth?: unknown;
    },
  ) => {
    runCompactionCalls.push({ deps: _deps, params });
    return { ok: true };
  },
);

// 必须在 import 任何会间接触发 run-compaction 模块加载的代码之前注册 mock。
mock.module("../../src/service/compaction-conditions/run-compaction.js", {
  namedExports: {
    runCompaction: runCompactionMock,
  },
});

const {
  createAgentRunner,
  InMemoryAgentSession,
} = await import("@novel-master/core/agent");
const { textBlocks } = await import("@novel-master/core/chat");
const { SimpleEventBus } = await import("@novel-master/core/events");
const { registerBuiltinTools, ToolRegistry } = await import("@novel-master/core");
const { createMemorySessionKkv } = await import(
  "../helpers/prompt-layout-test-helpers.js"
);
const { noopSavedModelRepository } = await import(
  "../helpers/noop-saved-model-repo.js"
);

const RUN_MODEL_ID = "anthropic/claude";
const MOCK_PROJECT_ID = "test-project";
const MOCK_SESSION_ID = "test-session";

function minimalDefinition(): AgentDefinition {
  return {
    name: "test",
    prompts: { persist: [], dynamic: [] },
  };
}

function mockVfs(): VfsService {
  const files = new Map<string, string>();
  return {
    async read(path: string) {
      const content = files.get(path) ?? "";
      return { path, content, version: 1, mtimeMs: 0 };
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
    projectId: MOCK_PROJECT_ID,
    sessionId: MOCK_SESSION_ID,
    listSessionMessages: async () => [],
  };
}

function createMockModel(
  responses: LlmChatResult[],
): ModelRequestService & { callCount: () => number } {
  let calls = 0;
  return {
    callCount: () => calls,
    request: mock.fn(async () => {
      const r = responses[calls];
      calls += 1;
      if (r == null) {
        throw new Error("Unexpected extra model request");
      }
      return r;
    }),
  };
}

/**
 * 构造一个可控的 CompactionConditionEvaluator：首次 shouldRequestCompaction 返回 true，
 * 之后返回 false（避免后续 step 反复触发，与 stepCompactionEmitted 单次门控语义一致）。
 */
function createCompactionConditionsStub(hideStartDepth: number) {
  let firstCall = true;
  return {
    shouldRequestCompaction: mock.fn(async () => {
      const hit = firstCall;
      firstCall = false;
      return hit;
    }),
    getHideStartDepth: mock.fn(async () => hideStartDepth),
  };
}

after(() => {
  mock.restoreAll();
});

describe("AgentRunner compaction (T-AR1)", () => {
  it("条件压缩命中时直调 runCompaction，传入 evaluator 的 hideStartDepth，不经事件编排器", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model = createMockModel([
      {
        assistantText: "done",
        blocks: [{ type: "text", text: "done" }],
        raw: {},
      },
    ]);

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);

    const HIDE_START_DEPTH = 7;
    const compactionConditions = createCompactionConditionsStub(
      HIDE_START_DEPTH,
    );

    // messages / messageTranscriptEffects 只需满足 runCompaction 被 mock 后
    // 不会真用到；用最小桩即可。非 null 即可让 agent-runner 走直调分支。
    const messagesStub = {
      listBySession: async () => [],
    } as unknown as MessageService;
    const effectsStub = {
      hideMessagesInRange: async () => {},
      showMessagesInRange: async () => {},
      truncateMessagesAfter: async () => {},
      setMessageFloorAtMessage: async () => {},
    } as unknown as MessageTranscriptEffectsService;

    const deps: CreateAgentRunnerDeps = {
      session,
      modelRequests: model,
      savedModels: noopSavedModelRepository(),
      registry,
      toolCtx: mockToolCtx(mockVfs()),
      eventBus: new SimpleEventBus(),
      sessionKkv: createMemorySessionKkv(),
      workplace: () =>
        ({
          scope: {
            kind: "session",
            projectId: MOCK_PROJECT_ID,
            sessionId: MOCK_SESSION_ID,
          },
          renderDisplay: async () => "WT",
          buildListRows: async () => [],
          materializePersistBlock: async () => ({ workplaceDisplay: "WT" }),
        }) as never,
      compactionConditions,
      messages: messagesStub,
      messageTranscriptEffects: effectsStub,
    };
    const runner = createAgentRunner(deps);

    const result = await runner.run({
      maxSteps: 1,
      definition: minimalDefinition(),
      sessionId: MOCK_SESSION_ID,
      projectId: MOCK_PROJECT_ID,
      savedModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    // run 正常完成（说明没有触发 "messages/messageTranscriptEffects 缺失" 的硬错误，
    // 也没有任何 eventOrchestrator 相关的依赖报错——CreateAgentRunnerDeps 根本没这个字段）。
    assert.equal(result.finished, true);

    // runCompaction 被调一次。
    assert.equal(runCompactionMock.mock.callCount(), 1);
    assert.equal(runCompactionCalls.length, 1);

    // 收到正确的 sessionId / projectId / hideStartDepth。
    const call = runCompactionCalls[0];
    assert.equal(call.params.sessionId, MOCK_SESSION_ID);
    assert.equal(call.params.projectId, MOCK_PROJECT_ID);
    assert.equal(call.params.hideStartDepth, HIDE_START_DEPTH);

    // evaluator.getHideStartDepth 在压缩分支被调一次（取 hideStartDepth 用）。
    assert.equal(compactionConditions.getHideStartDepth.mock.callCount(), 1);
    // shouldRequestCompaction 至少被调一次（每个 persist step 前都会评估）。
    assert.ok(
      compactionConditions.shouldRequestCompaction.mock.callCount() >= 1,
    );
  });
});
