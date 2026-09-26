/**
 * T-T4 / T-T5 / T-T5b：agent-runner 写/清 session API prompt token 缓存。
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  createAgentRunner,
  InMemoryAgentSession,
  type AgentDefinition,
  type BuiltinToolContext,
  type CreateAgentRunnerDeps,
} from "@novel-master/core/agent";
import { textBlocks } from "@novel-master/core/chat";
import { SimpleEventBus } from "@novel-master/core/events";
import {
  resolveCurrentPromptTokens,
  sessionApiPromptTokenCache,
  type LlmChatResult,
  type ModelRequestService,
} from "@novel-master/core/provider";
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";
import { type VfsService } from "@novel-master/core/vfs";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import { noopSavedModelRepository } from "../helpers/noop-saved-model-repo.js";
import { registerNodeTokenizerDriverForTests } from "../helpers/register-node-tokenizer-driver-for-tests.js";
import { createDefaultTokenCounterRegistry } from "../../src/infra/tokenizer/index.js";
import {
  PROMPT_TOKENS_LAST_USAGE_KEY,
  SESSION_KKV_DOMAIN_PROMPT_TOKENS,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import type { SessionKkvService } from "../../src/service/session-kkv/session-kkv.port.js";
import { emptyRegistryDeps } from "../infra/tokenizer/registry-test-helpers.js";
import { TokenRatioConditionTrigger } from "../../src/domain/compaction-conditions/triggers/token-ratio.trigger.js";

const RUN_MODEL_ID = "anthropic/claude";
const PROJECT_ID = "p-token-cache";
const SESSION_ID = "s-token-cache";

/**
 * 每个用例一个 session KKV：runner 的写/删断言直接落在它上面
 * （写侧是 fire-and-forget，但内存实现同步落 Map，run 返回即可读）。
 */
let sessionKkv: SessionKkvService;

/** 读 KKV 里落库的 prompt 占用原始值（null = 行不存在 / 已删）。 */
function rawPromptTokenRow(): Promise<string | null> {
  return sessionKkv.get(
    SESSION_ID,
    SESSION_KKV_DOMAIN_PROMPT_TOKENS,
    PROMPT_TOKENS_LAST_USAGE_KEY
  );
}

async function parsedPromptTokenRow(): Promise<
  | {
      promptTokens?: number;
      atMs?: number;
      runId?: string;
      savedModelId?: string;
      lastMessageSeq?: number;
    }
  | undefined
> {
  const raw = await rawPromptTokenRow();
  return raw == null ? undefined : JSON.parse(raw);
}

/**
 * 预置「上一轮 completed run 落下的」API 占用：热层 + KKV 双写，模拟
 * 重启前的一致状态。非 completed 收尾必须把两层一起清干净。
 */
async function seedPromptTokenEntry(promptTokens: number): Promise<void> {
  sessionApiPromptTokenCache.set(SESSION_ID, {
    promptTokens,
    updatedAt: Date.now(),
  });
  await sessionKkv.set(
    SESSION_ID,
    SESSION_KKV_DOMAIN_PROMPT_TOKENS,
    PROMPT_TOKENS_LAST_USAGE_KEY,
    JSON.stringify({
      promptTokens,
      atMs: Date.now(),
      runId: "run-previous",
      savedModelId: RUN_MODEL_ID,
    })
  );
}

function minimalDefinition(): AgentDefinition {
  return {
    name: "test",
    prompts: { persist: [], dynamic: [] },
  };
}

function mockVfs(): VfsService {
  return {
    async read(path: string) {
      return { path, content: "", version: 1, mtimeMs: 0 };
    },
    async write() {
      return { version: 1 };
    },
    async replace() {
      return { version: 1, replacements: 0 };
    },
    async list() {
      return [];
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
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    listSessionMessages: async () => [],
  };
}

function runnerDeps(
  deps: Omit<
    CreateAgentRunnerDeps,
    "eventBus" | "sessionKkv" | "workplace" | "savedModels"
  > &
    Partial<Pick<CreateAgentRunnerDeps, "savedModels">>,
): CreateAgentRunnerDeps {
  return {
    savedModels: noopSavedModelRepository(),
    ...deps,
    eventBus: new SimpleEventBus(),
    sessionKkv,
    workplace: () =>
      ({
        scope: { kind: "session", projectId: PROJECT_ID, sessionId: SESSION_ID },
        renderDisplay: async () => "",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ workplaceDisplay: "" }),
      }) as never,
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

const defaultRunScope = {
  sessionId: SESSION_ID,
  projectId: PROJECT_ID,
  savedModelId: RUN_MODEL_ID,
  workspaceModelId: RUN_MODEL_ID,
};

describe("AgentRunner session API prompt token cache", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
    sessionApiPromptTokenCache.clearAll();
    sessionKkv = createMemorySessionKkv();
  });

  afterEach(() => {
    sessionApiPromptTokenCache.clearAll();
  });

  it("T-T4: completed 且 pick 有值 → set 后 trigger 与 resolve 同值", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model = createMockModel([
      {
        assistantText: "done",
        blocks: [{ type: "text", text: "done" }],
        raw: {},
        usage: { promptTokens: 4242 },
      },
    ]);

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(mockVfs()),
      }),
    );

    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });
    assert.equal(result.stopReason, "completed");
    assert.equal(sessionApiPromptTokenCache.get(SESSION_ID)?.promptTokens, 4242);

    // 写侧双写：session KKV 行带上 runId / savedModelId / 末尾消息 seq
    const row = await parsedPromptTokenRow();
    assert.equal(row?.promptTokens, 4242);
    assert.equal(row?.savedModelId, RUN_MODEL_ID);
    assert.equal(typeof row?.runId, "string");
    assert.ok((row?.runId ?? "").length > 0, "runId 应带上 run 身份");
    assert.equal(typeof row?.lastMessageSeq, "number");

    const tokenRegistry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const params = {
      layout: { persist: [], dynamic: [] },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: RUN_MODEL_ID,
      registry: tokenRegistry,
    };

    // 跨重启语义：清掉进程内热层（≈ 进程重启）、只留 KKV，读口仍报同一 API 值
    sessionApiPromptTokenCache.clearAll();
    const afterRestart = await resolveCurrentPromptTokens(
      SESSION_ID,
      params,
      { sessionKkv }
    );
    assert.equal(afterRestart.source, "api");
    assert.equal(afterRestart.tokenCount, 4242);
    assert.equal(afterRestart.estimated, false);

    const resolved = await resolveCurrentPromptTokens(SESSION_ID, params);
    assert.equal(resolved.source, "api");
    assert.equal(resolved.tokenCount, 4242);

    const trigger = new TokenRatioConditionTrigger(
      {
        tokenRatio: 0.01,
        resolveContextWindow: async () => 100_000,
        resolveTokenizerOverride: async () => "auto",
      },
      tokenRegistry,
    );
    // 4242 > floor(100000*0.01)=1000 → true；且与 resolve 同读 API
    assert.equal(
      await trigger.shouldTrigger(session, {
        sessionId: SESSION_ID,
        modelContext: {
          workspaceModelId: RUN_MODEL_ID,
          savedModelId: RUN_MODEL_ID,
        },
        promptInput: { messages: [] },
        layout: { persist: [], dynamic: [] },
        ctx: { workplaceDisplay: "", messages: [] },
      }),
      true,
    );
  });

  it("T-T5: cancelled → clear，resolve 回退 local（不保留旧 API）", async () => {
    await seedPromptTokenEntry(7777);

    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model = createMockModel([
      {
        assistantText: "should-not-run",
        blocks: [{ type: "text", text: "should-not-run" }],
        raw: {},
        usage: { promptTokens: 9999 },
      },
    ]);

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(mockVfs()),
      }),
    );

    const controller = new AbortController();
    controller.abort();
    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
      signal: controller.signal,
    });
    assert.equal(result.stopReason, "cancelled");
    assert.equal(sessionApiPromptTokenCache.get(SESSION_ID), undefined);
    // 非 completed 收尾必须连 KKV 行一起清：否则重启后从 KKV 读回旧值
    assert.equal(await rawPromptTokenRow(), null);

    const tokenRegistry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const resolved = await resolveCurrentPromptTokens(SESSION_ID, {
      layout: { persist: [], dynamic: [] },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: RUN_MODEL_ID,
      registry: tokenRegistry,
    });
    assert.equal(resolved.source, "local");
  });

  it("T-T5 (max_steps): max_steps → clear，resolve 回退 local（不保留旧 API）", async () => {
    await seedPromptTokenEntry(7777);

    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "tu1",
            name: "write",
            input: { path: "/out.txt", content: "done" },
          },
        ],
        raw: {},
        usage: { promptTokens: 9999 },
      },
    ]);

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(mockVfs()),
      }),
    );

    const result = await runner.run({
      maxSteps: 1,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });
    assert.equal(result.stopReason, "max_steps");
    assert.equal(sessionApiPromptTokenCache.get(SESSION_ID), undefined);
    // 非 completed 收尾必须连 KKV 行一起清：否则重启后从 KKV 读回旧值
    assert.equal(await rawPromptTokenRow(), null);

    const tokenRegistry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const resolved = await resolveCurrentPromptTokens(SESSION_ID, {
      layout: { persist: [], dynamic: [] },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: RUN_MODEL_ID,
      registry: tokenRegistry,
    });
    assert.equal(resolved.source, "local");
  });

  it("T-T5b: FAILED/throw 后必 clear，resolve 回退 local", async () => {
    await seedPromptTokenEntry(8888);

    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model: ModelRequestService = {
      request: mock.fn(async () => {
        throw new Error("upstream boom");
      }),
    };

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(mockVfs()),
      }),
    );

    await assert.rejects(
      () =>
        runner.run({
          maxSteps: 3,
          definition: minimalDefinition(),
          ...defaultRunScope,
        }),
      /upstream boom/,
    );
    assert.equal(sessionApiPromptTokenCache.get(SESSION_ID), undefined);
    // 非 completed 收尾必须连 KKV 行一起清：否则重启后从 KKV 读回旧值
    assert.equal(await rawPromptTokenRow(), null);

    const tokenRegistry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const resolved = await resolveCurrentPromptTokens(SESSION_ID, {
      layout: { persist: [], dynamic: [] },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: RUN_MODEL_ID,
      registry: tokenRegistry,
    });
    assert.equal(resolved.source, "local");
  });
});
