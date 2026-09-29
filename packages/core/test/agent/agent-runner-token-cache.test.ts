/**
 * T-T4 / T-T5 / T-T5b：agent-runner 写/清 session API prompt token 缓存。
 *
 * G-1 组（T-G1a / T-G1b）覆盖「runner → trigger → 读口」这条真实接线：
 * 既有用例都直接调 helper/driver 或手工构造 context，把 agent-runner 里
 * `tools` / `sessionKkv` 两行删掉也不会变红。
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { z } from "zod";
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
import type { MessageService } from "../../src/service/chat/message.port.js";
import type { MessageTranscriptEffectsService } from "../../src/service/chat/message-transcript-effects.port.js";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import { noopSavedModelRepository } from "../helpers/noop-saved-model-repo.js";
import { registerNodeTokenizerDriverForTests } from "../helpers/register-node-tokenizer-driver-for-tests.js";
import { createDefaultTokenCounterRegistry } from "../../src/infra/tokenizer/index.js";
import { invalidateSessionApiPromptTokenEntry } from "../../src/infra/tokenizer/logic/session-api-prompt-token-store.js";
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
      savedModelId?: string;
      anchorSeq?: number;
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

    // 写侧双写：session KKV 行带上 promptTokens 与 savedModelId 指纹
    // （两个零读取方的可选加固字段已从值形状里移除，这里只断言仍存在的字段。）
    const row = await parsedPromptTokenRow();
    assert.equal(row?.promptTokens, 4242);
    assert.equal(row?.savedModelId, RUN_MODEL_ID);
    assert.equal(typeof row?.atMs, "number");

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

/**
 * 每 step usage 回锚（统计优先口径，2026-09-29）：run 内 step N 请求完成的
 * usage 必须在该 step 全部落库后写进热层/KKV，让 step N+1 的压缩评估直接
 * 命中 api 档——不再为读数付本地整串计数。
 */
describe("AgentRunner 每 step usage 回锚", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
    sessionApiPromptTokenCache.clearAll();
    sessionKkv = createMemorySessionKkv();
  });

  afterEach(() => {
    sessionApiPromptTokenCache.clearAll();
  });

  it("两步 run：step2 的压缩评估命中 step1 回锚的 api 基线（含增量），run 末终值带锚点", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    // step1：tool_use（usage 4000）→ step2：收尾文本（usage 5000）
    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "tu1",
            name: "demo",
            input: {},
          },
        ],
        raw: {},
        usage: { promptTokens: 4_000 },
      },
      {
        assistantText: "done",
        blocks: [{ type: "text", text: "done" }],
        raw: {},
        usage: { promptTokens: 5_000 },
      },
    ]);

    const tokenRegistry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const seen: { tokenCount: number; counterKind: string }[] = [];

    const registry = new ToolRegistry();
    registry.register({
      name: "demo",
      description: () => "demo tool",
      inputSchema: z.object({}),
      run: async () => ({}) as never,
    });

    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry: registry as never,
        toolCtx: mockToolCtx(mockVfs()),
        compactionConditions: {
          async shouldRequestCompaction(s, evaluation) {
            const resolved = await resolveCurrentPromptTokens(
              evaluation.sessionId,
              {
                layout: evaluation.layout,
                ctx: evaluation.ctx,
                savedModelId: evaluation.modelContext.savedModelId,
                registry: tokenRegistry,
                ...(evaluation.tools != null
                  ? { tools: evaluation.tools }
                  : {}),
              },
              { sessionKkv: evaluation.sessionKkv }
            );
            seen.push({
              tokenCount: resolved.tokenCount,
              counterKind: resolved.counterKind,
            });
            return false;
          },
          async getHideStartDepth() {
            return 6;
          },
        },
        messages: {
          listBySession: async () => [],
        } as unknown as MessageService,
        messageTranscriptEffects: {
          hideMessagesInRange: async () => {},
          showMessagesInRange: async () => {},
          truncateMessagesAfter: async () => {},
          setMessageFloorAtMessage: async () => {},
        } as unknown as MessageTranscriptEffectsService,
      }),
    );

    const result = await runner.run({
      maxSteps: 5,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });
    assert.equal(result.stopReason, "completed");
    assert.equal(seen.length, 2, "两步各评估一次");

    // step1：无基线 → 本地估算档（counterKind 是驱动家族名，非 api）
    assert.notEqual(seen[0]!.counterKind, "api");

    // step2：step1 的 usage（4000）已回锚 → api 基线 + 锚点后追加消息的增量
    assert.equal(
      seen[1]!.counterKind,
      "api",
      "step1 回锚后，step2 评估必须命中 api 档（零计数）"
    );
    assert.ok(
      seen[1]!.tokenCount > 4_000,
      "api 读值 = 基线 4000 + step1 追加消息（assistant + tool_results）的增量"
    );

    // run 末终值：step2 的 usage 5000，锚点 = step2 提示词末条消息 seq（3）
    const row = await parsedPromptTokenRow();
    assert.equal(row?.promptTokens, 5_000);
    assert.equal(row?.anchorSeq, 3);
    assert.equal(row?.savedModelId, RUN_MODEL_ID);
  });
});

/**
 * G-1：「runner → trigger → 读口」这条真实接线此前零覆盖——把
 * `agent-runner.ts` 里 `tools` / `sessionKkv` 两行删掉，不会有任何测试变红。
 *
 * 本组用**真实链路**（真 runner + 真 TokenRatioConditionTrigger + 真读口）
 * 把这两行钉住；自验方式：临时注释掉其中任一行，本组用例必须变红。
 */
describe("AgentRunner → TokenRatioConditionTrigger → 读口 接线 (G-1)", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
    sessionApiPromptTokenCache.clearAll();
    sessionKkv = createMemorySessionKkv();
  });

  afterEach(() => {
    sessionApiPromptTokenCache.clearAll();
  });

  /**
   * G-1 两条用例都走「真 trigger + 真读口」，只在返回前把读数记下来。
   *
   * 阈值一律设成必触发（tokenRatio 极小 + 超大 contextWindow），保证压缩
   * 评估一定走到读口、不被 `return false` 短路——否则「接线断了」会伪装成
   * 「读口压根没被调」。
   */
  const MUST_TRIGGER_OPTIONS = {
    tokenRatio: 0.0001,
    resolveContextWindow: async () => 1_000_000,
    resolveTokenizerOverride: async () => "auto",
  } as const;

  it("T-G1a: 重启（clearAll）后第二轮的压缩评估仍用 KKV 里的 api 值", async () => {
    // 第一轮：正常 completed，落下 4242 的 api 值。
    const firstSession = new InMemoryAgentSession();
    await firstSession.append("user", textBlocks("go"));
    const firstModel = createMockModel([
      {
        assistantText: "done",
        blocks: [{ type: "text", text: "done" }],
        raw: {},
        usage: { promptTokens: 4242 },
      },
    ]);
    const firstRegistry = new ToolRegistry();
    registerBuiltinTools(firstRegistry);
    const firstRunner = createAgentRunner(
      runnerDeps({
        session: firstSession,
        modelRequests: firstModel,
        registry: firstRegistry,
        toolCtx: mockToolCtx(mockVfs()),
      }),
    );
    const first = await firstRunner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });
    assert.equal(first.stopReason, "completed");
    assert.equal((await parsedPromptTokenRow())?.promptTokens, 4242);

    // 模拟重启：进程内热层清空，只留 KKV。
    sessionApiPromptTokenCache.clearAll();
    assert.equal(
      sessionApiPromptTokenCache.get(SESSION_ID),
      undefined,
      "热层应已清空，接下来只能靠 KKV"
    );

    // 第二轮：真实链路（runner 填 sessionKkv → trigger → 读口）必须命中 KKV 的
    // api 值 4242，而不是回退本地估算（本地档远小于 4242）。
    const secondSession = new InMemoryAgentSession();
    await secondSession.append("user", textBlocks("go again"));
    const secondModel = createMockModel([
      {
        assistantText: "done",
        blocks: [{ type: "text", text: "done" }],
        raw: {},
        usage: { promptTokens: 5000 },
      },
    ]);

    const tokenRegistry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const seen: { tokenCount: number; counterKind: string }[] = [];
    const realTrigger = new TokenRatioConditionTrigger(
      MUST_TRIGGER_OPTIONS,
      tokenRegistry,
    );

    const messagesStub = {
      listBySession: async () => [],
    } as unknown as MessageService;
    const effectsStub = {
      hideMessagesInRange: async () => {},
      showMessagesInRange: async () => {},
      truncateMessagesAfter: async () => {},
      setMessageFloorAtMessage: async () => {},
    } as unknown as MessageTranscriptEffectsService;

    const secondRegistry = new ToolRegistry();
    registerBuiltinTools(secondRegistry);
    const secondRunner = createAgentRunner(
      runnerDeps({
        session: secondSession,
        modelRequests: secondModel,
        registry: secondRegistry,
        toolCtx: mockToolCtx(mockVfs()),
        compactionConditions: {
          // 代理真实 trigger：先按同一 evaluation 读一次口记录读数，再委托给
          // 真 trigger 走它自己的判定——读数与判定走的是同一条链路。
          async shouldRequestCompaction(session, evaluation) {
            const resolved = await resolveCurrentPromptTokens(
              evaluation.sessionId,
              {
                layout: evaluation.layout,
                ctx: evaluation.ctx,
                savedModelId: evaluation.modelContext.savedModelId,
                registry: tokenRegistry,
                ...(evaluation.tools != null
                  ? { tools: evaluation.tools }
                  : {}),
              },
              { sessionKkv: evaluation.sessionKkv },
            );
            seen.push({
              tokenCount: resolved.tokenCount,
              counterKind: resolved.counterKind,
            });
            return realTrigger.shouldTrigger(session, evaluation);
          },
          async getHideStartDepth() {
            return 6;
          },
        },
        messages: messagesStub,
        messageTranscriptEffects: effectsStub,
      }),
    );

    const second = await secondRunner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });
    assert.equal(second.stopReason, "completed");

    assert.ok(seen.length > 0, "压缩评估应至少被调一次");
    for (const reading of seen) {
      assert.equal(
        reading.counterKind,
        "api",
        "热层已清空 → 必须从 KKV 读回 api 值（否则说明 sessionKkv 没接上）"
      );
      assert.equal(reading.tokenCount, 4242);
    }
  });

  it("T-G1b: tool description 变长 → 压缩评估的本地档 tokenCount 明显变大（tools 接上了）", async () => {
    const tokenRegistry = createDefaultTokenCounterRegistry(emptyRegistryDeps());

    /**
     * 跑一轮真实链路，返回压缩评估读口读到的本地档 tokenCount。
     *
     * 两次调用之间**只改 registry 里那个工具的 description 长度**——提示词、
     * 会话、模型桩、trigger 全部相同。差值即 `tools` 段进序列化串的贡献：
     * 把 agent-runner 里 `tools` 那行删掉，两次读数会完全相等 → 用例变红。
     */
    const runAndReadLocalCount = async (
      description: string
    ): Promise<{ tokenCount: number; toolCount: number }> => {
      const readings: { tokenCount: number; toolCount: number }[] = [];
      const realTrigger = new TokenRatioConditionTrigger(
        MUST_TRIGGER_OPTIONS,
        tokenRegistry,
      );
      const session = new InMemoryAgentSession();
      await session.append("user", textBlocks("go"));
      const model = createMockModel([
        {
          assistantText: "done",
          blocks: [{ type: "text", text: "done" }],
          raw: {},
        },
      ]);
      const registry = new ToolRegistry<BuiltinToolContext>();
      registry.register({
        name: "demo",
        description: () => description,
        inputSchema: z.object({}),
        run: async () => ({}) as never,
      });
      const runner = createAgentRunner(
        runnerDeps({
          session,
          modelRequests: model,
          registry: registry as never,
          toolCtx: mockToolCtx(mockVfs()),
          compactionConditions: {
            async shouldRequestCompaction(s, evaluation) {
              const resolved = await resolveCurrentPromptTokens(
                evaluation.sessionId,
                {
                  layout: evaluation.layout,
                  ctx: evaluation.ctx,
                  savedModelId: evaluation.modelContext.savedModelId,
                  registry: tokenRegistry,
                  ...(evaluation.tools != null
                    ? { tools: evaluation.tools }
                    : {}),
                },
                { sessionKkv: evaluation.sessionKkv },
              );
              readings.push({
                tokenCount: resolved.tokenCount,
                toolCount: evaluation.tools?.length ?? 0,
              });
              return realTrigger.shouldTrigger(s, evaluation);
            },
            async getHideStartDepth() {
              return 6;
            },
          },
          messages: {
            listBySession: async () => [],
          } as unknown as MessageService,
          messageTranscriptEffects: {
            hideMessagesInRange: async () => {},
            showMessagesInRange: async () => {},
            truncateMessagesAfter: async () => {},
            setMessageFloorAtMessage: async () => {},
          } as unknown as MessageTranscriptEffectsService,
        }),
      );
      // 清掉上一轮可能落下的 api 值：两轮都强制走本地档，比的才是 tools 段。
      await invalidateSessionApiPromptTokenEntry(sessionKkv, SESSION_ID);
      const result = await runner.run({
        maxSteps: 3,
        definition: minimalDefinition(),
        ...defaultRunScope,
      });
      assert.equal(result.stopReason, "completed");
      assert.ok(readings.length > 0, "压缩评估应至少被调一次");
      return readings[0]!;
    };

    const shortRun = await runAndReadLocalCount("短描述");
    const longRun = await runAndReadLocalCount("长描述".repeat(3000));

    assert.equal(shortRun.toolCount, 1, "runner 应把 registry 里的 1 个工具传下去");
    assert.equal(longRun.toolCount, 1);
    assert.ok(
      longRun.tokenCount > shortRun.tokenCount * 10,
      `tools 段应进压缩评估的估算串：short=${shortRun.tokenCount} long=${longRun.tokenCount}`
    );
  });
});
