import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { AgentRunResult } from "@/domain/agent/model/agent-run-result.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import { subagentTool } from "@/domain/tool/builtin/subagent-tool.js";
import type {
  BuiltinToolContext,
  BuiltinToolSubagentContext,
} from "@/domain/tool/builtin/builtin-tool-context.js";
import { ToolRunner } from "@/domain/tool/logic/tool-runner.js";
import { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { SessionService } from "@/service/chat/session.port.js";

const generalDef: AgentDefinition = {
  name: "general",
  prompts: { persist: [], dynamic: [] },
};

interface SetupOpts {
  readonly stopReason?: AgentRunResult["stopReason"];
  readonly parentSignal?: AbortSignal;
}

function setupParallel(opts: SetupOpts = {}): {
  readonly ctx: BuiltinToolContext;
  readonly subagent: BuiltinToolSubagentContext;
  readonly runChildAgentCalls: { childSessionId: string; signal: AbortSignal }[];
  readonly createdSessions: { id: string; title: string }[];
} {
  const stopReason = opts.stopReason ?? "completed";
  const runChildAgentCalls: { childSessionId: string; signal: AbortSignal }[] = [];
  const createdSessions: { id: string; title: string }[] = [];
  const childMsgs = new Map<string, ChatMessage[]>();
  let counter = 0;
  const defs = [generalDef];
  const agentRegistry: AgentRegistryService = {
    listAgentIds: async () => ["id-1"],
    list: async () => defs,
    get: async () => generalDef,
    getRawWire: async () => null,
    upsert: async () => undefined,
    delete: async () => undefined,
  };
  const messages: MessageService = {
    listBySession: async (sid) => childMsgs.get(sid) ?? [],
  } as unknown as MessageService;
  const sessions: SessionService = {
    createSubSession: async (_parent, _proj, title) => {
      counter += 1;
      const id = `child-${counter}`;
      createdSessions.push({ id, title: title ?? "" });
      childMsgs.set(id, [
        { role: "assistant", content: { blocks: [{ type: "text", text: `子代理 ${id} 的回复` }] } } as ChatMessage,
      ]);
      return { id, parentSessionId: _parent, projectId: _proj } as never;
    },
  } as unknown as SessionService;

  const subagent: BuiltinToolSubagentContext = {
    agentRegistry,
    messages,
    sessions,
    depth: 0,
    callableAgents: [{ name: "general" }],
    parentSignal: opts.parentSignal ?? new AbortController().signal,
    createChildSession: async (title) => {
      const s = await sessions.createSubSession("p", "proj", title);
      return s.id;
    },
    resolveChildModelId: (def) => ({
      savedModelId: def.model ?? "parent-saved",
      workspaceModelId: "ws-model",
    }),
    runChildAgent: async (_def, childSessionId, runOpts) => {
      runChildAgentCalls.push({ childSessionId, signal: runOpts.signal });
      // 模拟延迟，让 abort 有时间生效。
      await new Promise((r) => setTimeout(r, 20));
      return {
        stepsExecuted: 1,
        finished: stopReason === "completed",
        stopReason,
        rounds: [],
      };
    },
  };

  const ctx: BuiltinToolContext = {
    vfs: {} as never,
    projectId: "proj",
    sessionId: "parent",
    listSessionMessages: async () => [],
    subagent,
  };
  return { ctx, subagent, runChildAgentCalls, createdSessions };
}

describe("task 工具并行派生与 abort 级联", () => {
  it("T-T4: 单消息 2 个 task tool_use 并发执行，各自独立子 session 与回流", async () => {
    const { ctx } = setupParallel();
    const registry = new ToolRegistry<BuiltinToolContext>();
    registry.register(subagentTool);
    const runner = new ToolRunner(registry);

    const outcomes = await runner.runParallel(
      [
        {
          name: "task",
          input: {
            description: "任务 A",
            prompt: "请处理 A",
            subagentName: "general",
          },
        },
        {
          name: "task",
          input: {
            description: "任务 B",
            prompt: "请处理 B",
            subagentName: "general",
          },
        },
      ],
      ctx,
    );

    assert.equal(outcomes.length, 2);
    assert.ok(outcomes[0]!.ok && outcomes[1]!.ok);
    const out1 = outcomes[0]!.ok ? (outcomes[0] as { output: { text: string; subagentSessionId: string } }).output : null;
    const out2 = outcomes[1]!.ok ? (outcomes[1] as { output: { text: string; subagentSessionId: string } }).output : null;
    assert.ok(out1 && out2);
    assert.notEqual(out1.subagentSessionId, out2.subagentSessionId);
    assert.ok(out1.text.includes(out1.subagentSessionId));
    assert.ok(out2.text.includes(out2.subagentSessionId));
  });

  it("T-T5: abort 级联 — 父 signal abort 后子 runChildAgent 收到 abort 信号（task 自身不阻断）", async () => {
    const parentController = new AbortController();
    const { ctx, runChildAgentCalls } = setupParallel({
      parentSignal: parentController.signal,
    });
    const registry = new ToolRegistry<BuiltinToolContext>();
    registry.register(subagentTool);
    const runner = new ToolRunner(registry);

    // 启动 task 后立即 abort 父 signal。
    const promise = runner.runParallel(
      [
        {
          name: "task",
          input: {
            description: "x",
            prompt: "p",
            subagentName: "general",
          },
        },
      ],
      ctx,
    );
    parentController.abort();
    await promise;

    assert.equal(runChildAgentCalls.length, 1);
    // 子 agent run 收到的 signal 应反映父 abort（task 工具把 parentSignal 直接透传）。
    assert.ok(
      runChildAgentCalls[0]!.signal.aborted,
      "父 abort 后子 runChildAgent 收到的 signal 应已 aborted",
    );
  });

  it("T-T5: addEventListener('abort', ..., { once: true }) 仅触发一次（多 abort 不重复）", async () => {
    const parentController = new AbortController();
    let abortCount = 0;
    parentController.signal.addEventListener(
      "abort",
      () => {
        abortCount += 1;
      },
      { once: true },
    );
    parentController.abort();
    // 二次 abort 无效（已 aborted，不会再次触发 listener）。
    parentController.abort();
    assert.equal(abortCount, 1);
  });
});
