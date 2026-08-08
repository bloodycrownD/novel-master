import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { AgentRunResult } from "@/domain/agent/model/agent-run-result.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import { TextBlock, ToolResultBlock } from "@/domain/chat/model/content-block.js";
import { subagentTool } from "@/domain/tool/builtin/subagent-tool.js";
import type {
  BuiltinToolContext,
  BuiltinToolSubagentContext,
  RunChildAgentOptions,
} from "@/domain/tool/builtin/builtin-tool-context.js";
import { resolveAgentToolRegistry } from "@/domain/agent/logic/resolve-agent-tool-registry.js";
import { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import { registerBuiltinTools } from "@/domain/tool/builtin/register-builtin-tools.js";
import { ToolError } from "@/errors/tool-errors.js";
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { SessionService } from "@/service/chat/session.port.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";

const generalDef: AgentDefinition = {
  name: "general",
  prompts: { persist: [], dynamic: [] },
};

const nonCallableDef: AgentDefinition = {
  name: "writer",
  prompts: { persist: [], dynamic: [] },
};

/** 简化的 VfsService mock（仅满足 BuiltinToolContext 类型，不被实际调用）。 */
function fakeVfs(): VfsService {
  return {} as unknown as VfsService;
}

interface MockRunChildAgentResult {
  readonly result: AgentRunResult;
  readonly childMessages: ChatMessage[];
}

function makeMockSubagent(args: {
  readonly defs?: readonly AgentDefinition[];
  readonly callableAgents?: readonly { readonly name: string; readonly description?: string }[];
  readonly runResult?: MockRunChildAgentResult;
  readonly depth?: number;
  readonly capturedChildSessionIds?: string[];
  readonly capturedRunOpts?: RunChildAgentOptions[];
}): {
  readonly ctx: BuiltinToolSubagentContext;
  readonly childSessions: { readonly id: string; readonly title: string }[];
} {
  const depth = args.depth ?? 0;
  const defs = args.defs ?? [generalDef];
  const callableAgents =
    args.callableAgents ?? defs.map((d) => ({ name: d.name, description: d.description }));
  const childSessions: { id: string; title: string }[] = [];
  let sessionCounter = 0;
  const childMsgsBySession = new Map<string, ChatMessage[]>();

  const agentRegistry: AgentRegistryService = {
    listAgentIds: async () => defs.map((_, i) => `id-${i}`),
    list: async () => defs,
    get: async () => defs[0]!,
    getRawWire: async () => null,
    upsert: async () => undefined,
    delete: async () => undefined,
  };
  const messages: MessageService = {
    listBySession: async (sid) => childMsgsBySession.get(sid) ?? [],
  } as unknown as MessageService;
  const sessions: SessionService = {
    createSubSession: async (_parent, _project, title) => {
      sessionCounter += 1;
      const id = `child-${sessionCounter}`;
      childSessions.push({ id, title: title ?? "" });
      if (args.runResult != null) {
        childMsgsBySession.set(id, args.runResult.childMessages);
      }
      return { id, parentSessionId: _parent, projectId: _project } as never;
    },
  } as unknown as SessionService;

  const ctx: BuiltinToolSubagentContext = {
    agentRegistry,
    messages,
    sessions,
    depth,
    callableAgents,
    parentSignal: new AbortController().signal,
    createChildSession: async (title: string) => {
      const s = await sessions.createSubSession("p", "proj", title);
      return s.id;
    },
    resolveChildModelId: (def) => ({
      savedModelId: def.model ?? "parent-saved-model",
      workspaceModelId: "workspace-model",
    }),
    runChildAgent: async (def, childSessionId, opts) => {
      args.capturedChildSessionIds?.push(childSessionId);
      args.capturedRunOpts?.push(opts);
      // 在子 session 落末条 assistant text（与真实 agent runner 落库语义一致）
      if (args.runResult != null) {
        childMsgsBySession.set(childSessionId, args.runResult.childMessages);
      }
      return args.runResult?.result ?? {
        stepsExecuted: 1,
        finished: true,
        stopReason: "completed" as const,
        rounds: [],
      };
    },
  };
  return { ctx, childSessions };
}

function makeToolCtx(subagent: BuiltinToolSubagentContext): BuiltinToolContext {
  return {
    vfs: fakeVfs(),
    projectId: "proj",
    sessionId: "parent",
    listSessionMessages: async () => [],
    subagent,
  };
}

describe("subagent-tool / task", () => {
  it("T-T1: 基本闭环 — 末条 assistant text 回流，subagentSessionId 透传，子 tool 调用不出现", async () => {
    const expectedText = "子代理已完成：角色档案已生成。";
    const { ctx, childSessions } = makeMockSubagent({
      runResult: {
        // 子 agent 中间有 tool_use，末条才是最终 assistant text。
        childMessages: [
          { role: "assistant", content: { blocks: [{ type: "tool_use", id: "tu1", name: "read", input: { path: "/o.md" } }] } } as ChatMessage,
          { role: "user", content: { blocks: [{ type: "tool_result", toolUseId: "tu1", content: "..." }] } } as ChatMessage,
          { role: "assistant", content: { blocks: [{ type: "text", text: expectedText }] } } as ChatMessage,
        ],
        result: { stepsExecuted: 3, finished: true, stopReason: "completed", rounds: [] },
      },
    });
    const output = await subagentTool.run(
      { description: "生成角色档案", prompt: "请生成主角档案", subagentName: "general" },
      makeToolCtx(ctx),
    );
    assert.equal(output.text, expectedText);
    assert.equal(typeof output.subagentSessionId, "string");
    assert.equal(childSessions.length, 1);
    assert.equal(childSessions[0]!.title, "生成角色档案");
  });

  it("T-T1: title 回落到 prompt.slice(0,40)（description 为空时）", async () => {
    const { ctx, childSessions } = makeMockSubagent({
      runResult: {
        childMessages: [
          { role: "assistant", content: { blocks: [{ type: "text", text: "ok" }] } } as ChatMessage,
        ],
        result: { stepsExecuted: 1, finished: true, stopReason: "completed", rounds: [] },
      },
    });
    const longPrompt =
      "请帮我把这一段超长任务描述做些处理然后生成结果返回再来一段超出四十字符的填充内容结尾";
    await subagentTool.run(
      // description schema 是 min(1)，故测试直接构造 input 不走 schema：用空格 trim 后空
      { description: "   ", prompt: longPrompt, subagentName: "general" },
      makeToolCtx(ctx),
    );
    assert.equal(childSessions[0]!.title, longPrompt.slice(0, 40));
  });

  it("T-T3: 不在名单的 agent 被调用时不抛（运行时不再校验名单；名单由注册层管）", async () => {
    // 新设计：subagentCallable 已移除，task 运行时只查 registry 找 agent，
    // 找到就用（名单过滤在注册层 createSubagentTool description 拼装时完成）。
    // nonCallableDef 在 registry 里存在 → 不抛错（runChildAgent 会走完整流程，
    // 这里 mock 的 runChildAgent 会返回成功）。
    const { ctx } = makeMockSubagent({ defs: [nonCallableDef] });
    const result = await subagentTool.run(
      { description: "task", prompt: "p", subagentName: "writer" },
      makeToolCtx(ctx),
    );
    assert.ok(result, "registry 中存在的 agent 可被调用，不再需要 subagentCallable 校验");
  });

  it("T-T3: 不存在的 subagentName 抛 ToolError", async () => {
    const { ctx } = makeMockSubagent({ defs: [generalDef] });
    await assert.rejects(
      () =>
        subagentTool.run(
          { description: "t", prompt: "p", subagentName: "ghost" },
          makeToolCtx(ctx),
        ),
      (err: unknown) =>
        err instanceof ToolError && err.message.includes("未找到"),
    );
  });

  it("T-T7: description 含可选 subagent name 列表", () => {
    const ctxWithGeneral = makeToolCtx(
      makeMockSubagent({ callableAgents: [{ name: "general" }] }).ctx,
    );
    assert.ok(subagentTool.description(ctxWithGeneral).includes("general"));
    const ctxEmpty = makeToolCtx(makeMockSubagent({ callableAgents: [] }).ctx);
    // 即便空列表，description 也应描述能力（不崩）。
    assert.ok(subagentTool.description(ctxEmpty).includes("task"));
    assert.ok(subagentTool.description(ctxEmpty).includes("（暂无）"));
  });

  it("T-T7b: description 含每个 agent 的 description 文本（按 `名字：描述` 格式）", () => {
    const ctx = makeToolCtx(
      makeMockSubagent({
        callableAgents: [
          {
            name: "general",
            description: "通用助手，可以读写文件、搜索内容。",
          },
          {
            name: "researcher",
            description: "专门负责查资料和事实核查。",
          },
          { name: "nodescr" },
        ],
      }).ctx,
    );
    const desc = subagentTool.description(ctx);
    assert.ok(
      desc.includes("general：通用助手，可以读写文件、搜索内容。"),
      "应当拼出 `general：描述` 一行",
    );
    assert.ok(
      desc.includes("researcher：专门负责查资料和事实核查。"),
      "应当拼出 `researcher：描述` 一行",
    );
    // 没描述的 agent 只列名字，不应出现 `nodescr：`。
    assert.ok(desc.includes("nodescr"));
    assert.ok(!desc.includes("nodescr："));
  });

  it("T-T8: 子 agent stopReason !== completed → fallback 文本", async () => {
    const { ctx } = makeMockSubagent({
      runResult: {
        childMessages: [
          // 子 agent 中途 max_steps 截断，无末条 assistant text
          { role: "assistant", content: { blocks: [{ type: "tool_use", id: "x", name: "read", input: {} }] } } as ChatMessage,
        ],
        result: { stepsExecuted: 10, finished: false, stopReason: "max_steps", rounds: [] },
      },
    });
    const output = await subagentTool.run(
      { description: "t", prompt: "p", subagentName: "general" },
      makeToolCtx(ctx),
    );
    assert.equal(output.text, "[子代理未完成任务: stopReason=max_steps]");
    assert.ok(typeof output.subagentSessionId === "string");
  });

  it("T-T6: 模型解析 — 子 agent pin → 父 savedModelId（不走 workspace fallback）", async () => {
    let resolved: { savedModelId: string; workspaceModelId: string } | undefined;
    const { ctx } = makeMockSubagent({});
    // 包装 resolveChildModelId 以观察调用
    const wrappedCtx: BuiltinToolSubagentContext = {
      ...ctx,
      resolveChildModelId: (def) => {
        resolved = ctx.resolveChildModelId(def);
        return resolved;
      },
    };
    await subagentTool.run(
      { description: "t", prompt: "p", subagentName: "general" },
      makeToolCtx(wrappedCtx),
    );
    assert.ok(resolved != null);
    // general 没 pin model，落到父 savedModelId。
    assert.equal(resolved!.savedModelId, "parent-saved-model");
  });
});

describe("resolveAgentToolRegistry 递归上限", () => {
  function makeBaseRegistry(): ToolRegistry<BuiltinToolContext> {
    const r = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(r);
    return r;
  }
  const def: AgentDefinition = { name: "x", prompts: { persist: [], dynamic: [] } };

  it("T-T2: depth=0/1 保留 task；depth>=2（孙）强制 deny task", () => {
    const base = makeBaseRegistry();
    assert.ok(base.list().includes("task"));
    const r0 = resolveAgentToolRegistry(base, def, { depth: 0 });
    assert.ok(r0.list().includes("task"));
    const r1 = resolveAgentToolRegistry(base, def, { depth: 1 });
    assert.ok(r1.list().includes("task"));
    const r2 = resolveAgentToolRegistry(base, def, { depth: 2 });
    assert.ok(!r2.list().includes("task"), "孙 agent 不应有 task");
  });
});
