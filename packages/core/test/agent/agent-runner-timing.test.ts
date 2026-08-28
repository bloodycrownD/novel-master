/**
 * T-AR1~3（→ Step 3）：agent-runner 请求计时采集。
 *
 * - 流式请求：firstTokenMs = 首个内容事件（text-delta / thinking-delta）时刻 −
 *   发起时刻，durationMs = await 结束 − 发起（Date.now 打桩控制时间）；
 * - 非流式请求（无 onStream）：firstTokenMs === durationMs（完成时刻口径）；
 * - post-model abort 的 partial append 仍携带耗时字段；result.usage 缺失时
 *   usage 仅含两个耗时字段（token 统计不受影响）。
 */

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createAgentRunner,
  InMemoryAgentSession,
  type AgentDefinition,
  type CreateAgentRunnerDeps,
} from "@novel-master/core/agent";
import { textBlocks } from "@novel-master/core/chat";
import { registerBuiltinTools, ToolRegistry, type BuiltinToolContext } from "@novel-master/core";
import {
  type LlmChatRequest,
  type LlmChatResult,
  type ModelRequestService,
} from "@novel-master/core/provider";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import { type VfsService } from "@novel-master/core/vfs";
import { noopSavedModelRepository } from "../helpers/noop-saved-model-repo.js";
import { SimpleEventBus } from "@novel-master/core/events";

const RUN_MODEL_ID = "anthropic/claude";
const MOCK_PROJECT_ID = "test-project";
const MOCK_SESSION_ID = "test-session";

function minimalDefinition(): AgentDefinition {
  return {
    name: "test",
    prompts: { persist: [], dynamic: [] },
  };
}

const defaultRunScope = {
  sessionId: MOCK_SESSION_ID,
  projectId: MOCK_PROJECT_ID,
  savedModelId: RUN_MODEL_ID,
  workspaceModelId: RUN_MODEL_ID,
};

function runnerDeps(deps: RunnerDepsInput): CreateAgentRunnerDeps {
  return {
    savedModels: noopSavedModelRepository(),
    ...deps,
    eventBus: new SimpleEventBus(),
    sessionKkv: createMemorySessionKkv(),
    workplace: () =>
      ({
        scope: { kind: "session", projectId: MOCK_PROJECT_ID, sessionId: MOCK_SESSION_ID },
        renderDisplay: async () => "WT",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ workplaceDisplay: "WT" }),
      }) as never,
  };
}

type RunnerDepsInput = Omit<
  CreateAgentRunnerDeps,
  "eventBus" | "sessionKkv" | "workplace" | "savedModels"
> &
  Partial<Pick<CreateAgentRunnerDeps, "savedModels">>;

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

/** 可控时钟：Date.now 打桩后由 mock request 在关键时点推进。 */
function installFakeClock(): { clock: { now: number }; restore: () => void } {
  const clock = { now: 1_700_000_000_000 };
  const handle = mock.method(Date, "now", () => clock.now);
  return { clock, restore: () => handle.mock.restore() };
}

function makeRunner(
  session: InMemoryAgentSession,
  model: ModelRequestService,
): ReturnType<typeof createAgentRunner> {
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);
  return createAgentRunner(
    runnerDeps({
      session,
      modelRequests: model,
      registry,
      toolCtx: mockToolCtx(mockVfs()),
    }),
  );
}

describe("agent-runner 请求计时采集（T-AR）", () => {
  it("流式请求：firstTokenMs = 首个内容事件时刻 − 发起，durationMs = await 结束 − 发起（T-AR1）", async () => {
    const { clock, restore } = installFakeClock();
    try {
      const session = new InMemoryAgentSession();
      await session.append("user", textBlocks("go"));

      const model: ModelRequestService = {
        request: async (_id, _prompt, req: LlmChatRequest) => {
          // 此刻 runner 已记录 requestStartedAtMs；推进时钟模拟各事件时点。
          const started = Date.now();
          clock.now = started + 300;
          req.onStream?.({ type: "thinking-delta", text: "hmm" });
          clock.now = started + 500;
          req.onStream?.({ type: "text-delta", text: "he" });
          clock.now = started + 2300;
          const result: LlmChatResult = {
            assistantText: "hi",
            blocks: [{ type: "text", text: "hi" }],
            raw: {},
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          };
          return result;
        },
      };

      const runner = makeRunner(session, model);
      const result = await runner.run({
        maxSteps: 1,
        definition: minimalDefinition(),
        stream: true,
        onStream: () => {},
        ...defaultRunScope,
      });

      assert.equal(result.stopReason, "completed");
      const msgs = await session.list();
      const assistant = msgs.find((m) => m.role === "assistant");
      assert.ok(assistant, "应 append 一条 assistant message");
      // thinking-delta 先到 → firstTokenMs 取 300ms；await 结束在 2300ms。
      assert.equal(assistant!.usage?.firstTokenMs, 300);
      assert.equal(assistant!.usage?.durationMs, 2300);
      // token 字段照常透传。
      assert.equal(assistant!.usage?.promptTokens, 10);
      assert.equal(assistant!.usage?.completionTokens, 20);
    } finally {
      restore();
    }
  });

  it("非流式请求（无 onStream）：firstTokenMs === durationMs（done 时刻口径，T-AR2）", async () => {
    const { clock, restore } = installFakeClock();
    try {
      const session = new InMemoryAgentSession();
      await session.append("user", textBlocks("go"));

      const model: ModelRequestService = {
        request: async (_id, _prompt, _req: LlmChatRequest) => {
          const started = Date.now();
          clock.now = started + 1800;
          return {
            assistantText: "hi",
            blocks: [{ type: "text", text: "hi" }],
            raw: {},
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          } satisfies LlmChatResult;
        },
      };

      const runner = makeRunner(session, model);
      const result = await runner.run({
        maxSteps: 1,
        definition: minimalDefinition(),
        ...defaultRunScope,
      });

      assert.equal(result.stopReason, "completed");
      const msgs = await session.list();
      const assistant = msgs.find((m) => m.role === "assistant");
      assert.ok(assistant);
      assert.equal(assistant!.usage?.durationMs, 1800);
      assert.equal(
        assistant!.usage?.firstTokenMs,
        assistant!.usage?.durationMs,
        "非流式 TTFT = 总时长",
      );
    } finally {
      restore();
    }
  });

  it("post-model abort 的 partial append 仍携带耗时；result.usage 缺失时 usage 仅含耗时字段（T-AR3）", async () => {
    const { clock, restore } = installFakeClock();
    try {
      const session = new InMemoryAgentSession();
      await session.append("user", textBlocks("go"));

      const controller = new AbortController();
      const model: ModelRequestService = {
        request: async (_id, _prompt, _req: LlmChatRequest) => {
          const started = Date.now();
          // 请求进行中 abort，但 request 正常返回（post-model abort 路径）
          controller.abort();
          clock.now = started + 900;
          return {
            assistantText: "partial",
            blocks: [{ type: "text", text: "partial" }],
            raw: {},
            // 无 usage：断言 usage 仅含两个耗时字段
          } satisfies LlmChatResult;
        },
      };

      const runner = makeRunner(session, model);
      const result = await runner.run({
        maxSteps: 2,
        definition: minimalDefinition(),
        signal: controller.signal,
        ...defaultRunScope,
      });

      assert.equal(result.stopReason, "cancelled");
      const msgs = await session.list();
      const assistant = msgs.find((m) => m.role === "assistant");
      assert.ok(assistant, "abort 前已写入 partial assistant");
      assert.deepEqual(assistant!.usage, { firstTokenMs: 900, durationMs: 900 });
      // token 字段缺失 → 不影响统计口径（USAGE_NOT_NULL_SQL 不计入该行）
      assert.equal(assistant!.usage?.promptTokens, undefined);
    } finally {
      restore();
    }
  });
});
