/**
 * T-P3 / T-P4 / T-P8 / T-P9（phase-agent-policy）：经 runAgentTurn 完整路径锁
 * 「MCP 占位替换」的装配语义（spec §D）。走真实 in-memory DB + scriptedModel
 * 按调用序回放，在 ModelRequestService.request 的 options.tools 缝上断言模型
 * 侧工具名单：
 * - T-P4：无策略 → 主 run 见全部自带 + mcp__ 工具，从不出现占位 mcp；
 * - T-P3：allow ["mcp","read"] → 替换后的 mcp__ 与 read，allow 外的自带工具不出现；
 * - T-P8：子智能体按自己的策略筛选与替换，不继承父；
 * - T-P9：runtime.mcp 未注入 → 主 run 与子 run 都只有 11 个自带工具（占位被注销）。
 *
 * @module test/service/agent/run-agent-turn-mcp-placeholder.test
 */

import {  Result  } from "../../../src/errors/either.js";
import type { AppError } from "../../../src/errors/app-error.js";
import {  unwrap  } from "../../helpers/result-unwrap.js";
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";

import {  AgentServiceFactory, AgentTurnRunner, type AgentDefinition, type  AgentTurnRuntimePort  } from "@novel-master/core/agent";
import type { LlmChatResult } from "@novel-master/core/llm-protocol";
import type { McpConnectionManager } from "@novel-master/core/mcp";
import type {
    ModelRequestService,
    ModelRequestOptions,
} from "@/service/provider/model-request.port.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const TEST_SAVED_MODEL_ID = "00000000-0000-4000-8000-0000000000b1";
const PROJECT_MODEL_ID = "00000000-0000-4000-8000-0000000000b2";

/** 子代理 def：被 task 工具派生时用（name 不能用内置名 general）。 */
const childAgentDef: AgentDefinition = {
    name: "child-worker",
    prompts: { persist: [], dynamic: [] },
    model: PROJECT_MODEL_ID,
    mode: "subagent",
};

function mockUserVfsTurn(): UserVfsTurnService {
    return {
        executeOp: async () => ({ ok: true }),
    };
}

/** 构造一轮 task tool_use 的 model 响应。 */
function taskToolUseResponse(toolUseId: string): LlmChatResult {
    return {
        assistantText: "",
        blocks: [
            {
                type: "tool_use",
                id: toolUseId,
                name: "task",
                input: {
                    description: "子任务",
                    prompt: "请完成子任务",
                    subagentName: "child-worker",
                },
            },
        ],
        raw: {},
    };
}

/** 构造一轮纯文本完成响应（裸 LlmChatResult；Result 包装由 scriptedModel 统一做）。 */
function textDoneResponse(text: string): LlmChatResult {
    return {
        assistantText: text,
        blocks: [{ type: "text", text }],
        raw: {},
    };
}

/** 注册测试不触达调用通道的 stub 管理器（cachedTools 返回一条固定快照）。 */
function stubMcpManager(): McpConnectionManager {
    return {
        serverTools: () => [],
        cachedTools: () => [{ serverId: "fs", toolName: "query", toolDescription: "查询" }],
        connectUnconnected: async () => {},
        connect: async () => ({ serverId: "fs", state: "pending" }),
        serverStatuses: () => [],
        callTool: async () => Result.err({ kind: "protocol", action: "report", detail: "stub: 装配测试不应触达 callTool" }),
        invalidate: () => {},
        closeAll: async () => {},
    };
}

/**
 * 按调用序回放的 mock modelRequests：记录每次 request 收到的模型侧工具名
 * （options.tools 的 name 列表），作为占位替换的断言缝。
 */
function scriptedModel(responses: readonly LlmChatResult[]): ModelRequestService & { readonly toolNames: readonly (readonly string[])[] } {
    const toolNames: string[][] = [];
    let calls = 0;
    return {
        toolNames,
        request: async (_savedModelId: string, _userContent: string, options?: ModelRequestOptions): Promise<Result<LlmChatResult, AppError>> => {
            const idx = calls;
            calls += 1;
            toolNames.push((options?.tools ?? []).map((tool) => tool.name));
            const r = responses[idx];
            if (r == null) {
                throw new Error(`scriptedModel: 第 ${idx} 次调用无预设响应（responses.length=${responses.length}）`);
            }
            return Result.ok(r);
        },
    };
}

/** 装配一轮 run 的 runtime；`args.mcp` 传 stubMcpManager() 注入 MCP 切片，不注入 = T-P9 的「无 MCP 运行环境」。 */
function makeRuntime(ctx: ReturnType<typeof getNovelMasterTestContext>, args: { readonly modelRequests: ModelRequestService; readonly mcp?: McpConnectionManager }): AgentTurnRuntimePort {
    const registry = AgentServiceFactory.createRegistry(ctx.conn, ctx.state);
    return {
        state: {
            getCurrentAgentId: () => ctx.state.getCurrentAgentId(),
            getCurrentModelId: async () => Result.ok(TEST_SAVED_MODEL_ID),
            getSubagentNames: async () => [],
        },
        agentRegistry: registry,
        abortRegistry: AgentServiceFactory.createAbortRegistry(),
        projects: ctx.projects,
        messages: ctx.messages,
        messageCheckpoint: ctx.messageCheckpoint,
        modelRequests: args.modelRequests,
        ...(args.mcp != null ? { mcp: { connectionManager: args.mcp } } : {}),
        savedModelRepo: {
            findById: async () =>
                Result.ok({
                id: TEST_SAVED_MODEL_ID,
                providerId: "test-provider",
                alias: "test-model",
                protocolName: "anthropic",
                protocolModelId: "claude-test",
                thinkingEnabled: false,
                createdAt: 0,
                settings: {
                    schemaVersion: 2,
                    internal: { contextWindowTokens: 100000, tokenCounterMode: "auto" },
                    generation: { sampling: { enabled: false }, thinkingLevel: "off" },
                },
            }),
        } as AgentTurnRuntimePort["savedModelRepo"],
        providerRepo: {
            findById: async () => ({
                id: "test-provider",
                name: "test",
                protocolName: "anthropic",
                baseUrl: "https://example.invalid",
                authToken: "",
                createdAt: 0,
            }),
        },
        eventBus: realEventBus(),
        compactionConditionEvaluator:
            undefined as unknown as AgentTurnRuntimePort["compactionConditionEvaluator"],
        eventOrchestrator:
            undefined as unknown as AgentTurnRuntimePort["eventOrchestrator"],
        sessionKkv: ctx.sessionKkv,
        sessionVfs: (projectId, sessionId) =>
            ctx.sessionVfs(projectId, sessionId),
        workplace: () =>
            ({
                renderDisplay: async () => Result.ok(""),
                buildListRows: async () => Result.ok([]),
                materializePersistBlock: async () => Result.ok({ workplaceDisplay: "" }),
                evaluateRuleView: async () =>
                    Result.ok({
                        rows: [],
                        displayByPath: new Map(),
                    }),
            }) as ReturnType<AgentTurnRuntimePort["workplace"]>,
        userVfsTurn: mockUserVfsTurn(),
        sessions: ctx.sessions,
    };
}

/** 装配一个 real eventBus（runChildAgent publishRunLifecycle=true 会发事件）。 */
function realEventBus(): AgentTurnRuntimePort["eventBus"] {
    const handlers = new Map<string, Set<(payload: unknown) => void>>();
    return {
        publish: (type: string, payload: unknown) => {
            const set = handlers.get(type);
            if (set != null) for (const h of set) h(payload);
        },
        subscribe: (type: string, handler: (payload: unknown) => void) => {
            let set = handlers.get(type);
            if (set == null) {
                set = new Set();
                handlers.set(type, set);
            }
            set.add(handler);
            return () => set!.delete(handler);
        },
        unsubscribe: (type: string, handler: (payload: unknown) => void) => {
            handlers.get(type)?.delete(handler);
        },
    } as AgentTurnRuntimePort["eventBus"];
}

/** 注册主 agent def（test-default-agent，model 必填；tools 策略按用例传）。 */
async function seedDefaultAgent(ctx: ReturnType<typeof getNovelMasterTestContext>, def: Omit<AgentDefinition, "name" | "prompts" | "model">): Promise<void> {
    const registry = AgentServiceFactory.createRegistry(ctx.conn, ctx.state);
    await registry.upsert("test-default-agent", {
        name: "测试默认 Agent",
        prompts: { persist: [], dynamic: [] },
        model: TEST_SAVED_MODEL_ID,
        ...def,
    });
}

/** 注册子代理 def 到 registry（mode=subagent，确保可被 task 工具调用）。 */
async function seedChildAgent(ctx: ReturnType<typeof getNovelMasterTestContext>, def: Omit<AgentDefinition, "name" | "prompts" | "model" | "mode"> = {}): Promise<void> {
    const registry = AgentServiceFactory.createRegistry(ctx.conn, ctx.state);
    await registry.upsert("child-worker", { ...childAgentDef, ...def });
}

/** 跑一轮纯文本主 run（1 次模型请求），返回每次请求的模型侧工具名。 */
async function runSingleTurn(ctx: ReturnType<typeof getNovelMasterTestContext>, args: { readonly mcp?: McpConnectionManager; readonly def?: Omit<AgentDefinition, "name" | "prompts" | "model"> }): Promise<readonly (readonly string[])[]> {
    await seedDefaultAgent(ctx, args.def ?? {});
    const modelRequests = scriptedModel([textDoneResponse("完成")]);
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const session = unwrap(await ctx.sessions.create(project.id, "S-MCP-PLACEHOLDER"));
    const runtime = makeRuntime(ctx, { modelRequests, mcp: args.mcp });
    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);
    const result = unwrap(await AgentTurnRunner.run(runtime, { projectId: project.id, sessionId: session.id }, "打个招呼", { stream: false, onStream: () => {} }));
    assert.equal(result.stopReason, "completed");
    return modelRequests.toolNames;
}

/**
 * 跑一轮「主 agent 发 task → 子 agent 完成 → 主 agent 收尾」的完整 turn，
 * 返回每次请求的模型侧工具名（[主, 子, 主] 三次）。
 */
async function runTaskTurn(ctx: ReturnType<typeof getNovelMasterTestContext>, args: { readonly mcp?: McpConnectionManager; readonly parentDef?: Omit<AgentDefinition, "name" | "prompts" | "model">; readonly childDef?: Omit<AgentDefinition, "name" | "prompts" | "model" | "mode"> }): Promise<readonly (readonly string[])[]> {
    await seedDefaultAgent(ctx, args.parentDef ?? {});
    await seedChildAgent(ctx, args.childDef ?? {});
    const modelRequests = scriptedModel([taskToolUseResponse("tu-mcp"), textDoneResponse("子代理已完成"), textDoneResponse("主代理收到结果")]);
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const session = unwrap(await ctx.sessions.create(project.id, "S-MCP-PLACEHOLDER-TASK"));
    const runtime = makeRuntime(ctx, { modelRequests, mcp: args.mcp });
    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);
    const result = unwrap(await AgentTurnRunner.run(runtime, { projectId: project.id, sessionId: session.id }, "请派生子代理完成任务", { stream: false, onStream: () => {} }));
    assert.equal(result.stopReason, "completed");
    assert.equal(modelRequests.toolNames.length, 3, `应有 3 次 model 调用（主/子/主），实际=${modelRequests.toolNames.length}`);
    return modelRequests.toolNames;
}

describe("runAgentTurn 的 MCP 占位替换（spec §D）", () => {
    it("T-P4: 无策略 → 主 run 模型侧含全部自带工具与 mcp__ 工具，从不出现占位 mcp", async () => {
        const ctx = getNovelMasterTestContext();
        const toolNames = await runSingleTurn(ctx, { mcp: stubMcpManager() });
        const names = toolNames[0]!;
        assert.ok(names.includes("mcp__fs__query"), `应含替换后的 mcp__ 工具，实际=${JSON.stringify(names)}`);
        assert.ok(!names.includes("mcp"), "占位 mcp 永远到不了模型");
        assert.ok(names.includes("read") && names.includes("task"), "无策略时全部自带工具在列");
        assert.equal(names.length, 12, "11 自带 + 1 mcp__");
    });

    it("T-P3: allow: [\"mcp\", \"read\"] → 主 run 模型侧含替换后的 mcp__ 工具与 read，不含 allow 外工具与占位", async () => {
        const ctx = getNovelMasterTestContext();
        const toolNames = await runSingleTurn(ctx, { mcp: stubMcpManager(), def: { tools: { allow: ["mcp", "read"] } } });
        const names = toolNames[0]!;
        assert.ok(names.includes("mcp__fs__query"), `allow 含 mcp 时应替换出 mcp__ 工具，实际=${JSON.stringify(names)}`);
        assert.ok(names.includes("read"));
        assert.ok(!names.includes("mcp"), "占位 mcp 到不了模型");
        assert.ok(!names.includes("write") && !names.includes("task"), "allow 外的自带工具不在列");
    });

    it("T-P8: 子智能体按自己的策略筛选与替换，不继承父", async () => {
        const ctx = getNovelMasterTestContext();
        const toolNames = await runTaskTurn(ctx, { mcp: stubMcpManager(), childDef: { tools: { allow: ["read"] } } });
        assert.ok(toolNames[0]!.includes("mcp__fs__query"), "父（无策略）的模型侧含 mcp__ 工具");
        const childNames = toolNames[1]!;
        assert.ok(!childNames.includes("mcp__fs__query"), `子按自己的 allow 筛选，不继承父的 mcp__，实际=${JSON.stringify(childNames)}`);
        assert.ok(!childNames.includes("mcp"), "占位 mcp 到不了模型");
        assert.deepEqual(childNames, ["read"], "子模型侧只有自己 allow 名单内的工具");
    });

    it("T-P9: runtime.mcp 未注入 → 主 run 模型侧只有 11 个自带工具（占位被注销，无 mcp 也无 mcp__）", async () => {
        const ctx = getNovelMasterTestContext();
        const toolNames = await runSingleTurn(ctx, {});
        const names = toolNames[0]!;
        assert.ok(!names.includes("mcp"), "占位 mcp 被注销");
        assert.ok(names.every((name) => !name.startsWith("mcp__")), "无 MCP 环境，无 mcp__ 工具");
        assert.equal(names.length, 11);
    });

    it("T-P9: runtime.mcp 未注入 → 子 run 同样无占位也无 mcp__（子 mode 摘 task/agent 后自带 9 件）", async () => {
        const ctx = getNovelMasterTestContext();
        const toolNames = await runTaskTurn(ctx, {});
        const childNames = toolNames[1]!;
        assert.ok(!childNames.includes("mcp"), "子 run 的占位 mcp 被注销");
        assert.ok(childNames.every((name) => !name.startsWith("mcp__")), "子 run 无 mcp__ 工具");
        // 子 agent 硬规则摘 task / agent：12 件 - task - agent - 占位注销 = 9。
        assert.equal(childNames.length, 9);
    });
});
