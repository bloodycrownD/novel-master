/**
 * C1-3：subagent 取末条 assistant text 改走 tail+role 读口。
 *
 * 观测面 = **`MessageService` 层的桩**（不是 repository prototype）：本文件沿用既有
 * `makeMockSubagent` 形态（`runChildAgent` 是桩、不跑真 agent）。⚠️ 若改走真实 agent，
 * `listBySession` 的计数不可能为 0（agent 每 step 的 `session.list()` 走的仍是它），
 * 口径会整个变样。
 */
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
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { SessionService } from "@/service/chat/session.port.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";

const generalDef: AgentDefinition = {
  name: "general",
  prompts: { persist: [], dynamic: [] },
};

function fakeVfs(): VfsService {
  return {} as unknown as VfsService;
}

interface Counts {
  listBySession: number;
  listBySessionTailOfRole: number;
}

function assistantText(text: string): ChatMessage {
  return {
    role: "assistant",
    content: { blocks: [{ type: "text", text }] },
  } as unknown as ChatMessage;
}

function assistantToolUseOnly(id: string): ChatMessage {
  return {
    role: "assistant",
    content: {
      blocks: [{ type: "tool_use", id, name: "read", input: { path: "/a" } }],
    },
  } as unknown as ChatMessage;
}

function toolResult(id: string): ChatMessage {
  return {
    role: "user",
    content: {
      blocks: [{ type: "tool_result", toolUseId: id, content: "..." }],
    },
  } as unknown as ChatMessage;
}

/** 复刻既有 mock subagent，但把 `messages` 的两个读口都装上计数器。 */
function makeMock(childMessages: readonly ChatMessage[], counts: Counts): {
  readonly ctx: BuiltinToolSubagentContext;
} {
  const agentRegistry: AgentRegistryService = {
    listAgentIds: async () => ["id-0"],
    list: async () => [generalDef],
    get: async () => generalDef,
    getRawWire: async () => null,
    upsert: async () => undefined,
    delete: async () => undefined,
  };
  const messages: MessageService = {
    listBySession: async () => {
      counts.listBySession += 1;
      return [...childMessages];
    },
    listBySessionTailOfRole: async (_sid, options) => {
      counts.listBySessionTailOfRole += 1;
      // 与 SqliteMessageRepository.listBySessionTailOfRole 同款：先按 role 过滤
      // 再取末 limit 条（夹在中间的其它 role 不占配额）。
      return childMessages
        .filter((m) => m.role === options.role)
        .slice(-Math.max(1, Math.floor(options.limit)));
    },
  } as unknown as MessageService;
  const sessions: SessionService = {
    createSubSession: async () => ({ id: "child-1" }) as never,
  } as unknown as SessionService;
  const result: AgentRunResult = {
    stepsExecuted: 1,
    finished: true,
    stopReason: "completed",
    rounds: [],
  };
  return {
    ctx: {
      agentRegistry,
      messages,
      sessions,
      depth: 0,
      callableAgents: [{ name: "general" }],
      parentSignal: new AbortController().signal,
      createChildSession: async () => "child-1",
      resolveChildModelId: () => ({
        savedModelId: "m",
        workspaceModelId: "m",
      }),
      runChildAgent: async () => result,
    },
  };
}

function toolCtx(subagent: BuiltinToolSubagentContext): BuiltinToolContext {
  return {
    vfs: fakeVfs(),
    projectId: "proj",
    sessionId: "parent",
    subagent,
  };
}

async function runTask(
  messages: readonly ChatMessage[]
): Promise<{ text: string; counts: Counts }> {
  const counts: Counts = { listBySession: 0, listBySessionTailOfRole: 0 };
  const { ctx } = makeMock(messages, counts);
  const output = await subagentTool.run(
    { description: "d", prompt: "p", subagentName: "general" },
    toolCtx(ctx),
  );
  return { text: output.text, counts };
}

describe("subagent 末条 assistant text：tail+role 读口", () => {
  it("T-SUB-TAIL1 零次全量读、取 tail(assistant,8)", async () => {
    const messages: ChatMessage[] = [];
    // 50 条子会话夹具（含 tool_result 夹层）。
    for (let i = 0; i < 20; i++) {
      messages.push(assistantToolUseOnly(`tu-${i}`));
      messages.push(toolResult(`tu-${i}`));
    }
    messages.push(assistantText("末条正文"));

    const { text, counts } = await runTask(messages);
    assert.equal(text, "末条正文");
    assert.equal(counts.listBySession, 0, "不得触发全量读口");
    assert.equal(counts.listBySessionTailOfRole, 1);
  });

  it("T-SUB-TAIL2 尾部夹 5 条 tool_result 仍取到末条 assistant 正文", async () => {
    const messages: ChatMessage[] = [assistantText("目标正文")];
    for (let i = 0; i < 5; i++) {
      messages.push(toolResult(`tu-${i}`));
    }
    const { text, counts } = await runTask(messages);
    // limit=1 会被这 5 条 user/tool_result 吃掉 ⇒ role 过滤是必需的。
    assert.equal(text, "目标正文");
    assert.equal(counts.listBySession, 0);
  });

  it("T-SUB-TAIL3 连续 9 条 tool_use-only assistant → 已知差异：undefined + 兜底文案", async () => {
    const messages: ChatMessage[] = [assistantText("更早的正文")];
    for (let i = 0; i < 9; i++) {
      messages.push(assistantToolUseOnly(`tu-x-${i}`));
      messages.push(toolResult(`tu-x-${i}`));
    }
    const { text, counts } = await runTask(messages);
    // limit=8 只覆盖不到更早那条 → 返回兜底文案（把已知差异钉成期望）。
    assert.match(text, /^\[子代理未完成任务: stopReason=completed\]$/);
    assert.equal(counts.listBySessionTailOfRole, 1);
  });
});