/**
 * `task` 工具实现：主 agent 在对话回合内通过工具调用派生子 agent 执行子任务。
 *
 * 数据流（SPEC agent-subagent 总体方案）：
 *   1. `agentRegistry.list()` → `find(name === subagentName)` → `AgentDefinition`
 *      （校验 `subagentCallable === true`）
 *   2. `createChildSession(title = input.description ?? input.prompt.slice(0, 40))`
 *   3. `resolveChildModelId(def)` → savedModelId（子 pin → 父 savedModelId → 报错）
 *   4. `runChildAgent(def, childSessionId, opts)`（内部派生 AbortController）
 *   5. `messages.listBySession(childSessionId)` 取末条 assistant text
 *      （`AgentRunResult` 不带文本，必须自己 listBySession）
 *   6. fallback（P1-7）：`result.stopReason !== "completed"` 或末条 assistant 无 text block
 *      时，`text` 返回 `[子代理未完成任务: stopReason=...]`，`subagentSessionId` 仍填上
 *   7. 返回 `{ text, subagentSessionId: childSessionId }`（P0-1 方案 B）
 *
 * `agent-runner.ts` L443 的 `buildToolResultBlock` 调用处会从 `outcome.output.subagentSessionId`
 * 提取并写入 `ToolResultBlock.meta`（C32/C34）；`format-tool-output` 先剩掉 `subagentSessionId`
 * 再提取 `text` 返回原始文本（C33，不走 `JSON.stringify`），避免 `{"text": "..."}` JSON 壳回流给 LLM。
 *
 * @module domain/tool/builtin/subagent-tool
 */

import { z } from "zod";

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { TextBlock } from "@/domain/chat/model/content-block.js";
import { ToolError } from "@/errors/tool-errors.js";
import type { Tool } from "../model/tool.js";
import type { BuiltinToolContext } from "./builtin-tool-context.js";

/** `task` 工具输入。 */
export interface TaskToolInput {
  /** 3-5 词任务描述，用于子 session title。 */
  readonly description: string;
  /** 给子 agent 的任务正文。 */
  readonly prompt: string;
  /** 目标 subagent 的 name（非 UUID id）；指向 registry 中 `subagentCallable=true` 的 agent。 */
  readonly subagentName: string;
}

/** `task` 工具输出（P0-1 方案 B）：text 回流给主 agent LLM，subagentSessionId 是 UI-only。 */
export interface TaskToolOutput {
  readonly text: string;
  readonly subagentSessionId: string;
}

/** 递归上限：depth >= 2（孙 agent）不允许调用 task（已被 registry 层 deny，双保险）。 */
const SUBAGENT_MAX_DEPTH = 2;

/**
 * 从子 session 消息列表提取末条 assistant 的合并 text（按 block 顺序拼接）。
 *
 * @returns 末条 assistant 文本；不存在或无 text block 时返回 undefined。
 */
function extractLastAssistantText(
  messages: readonly ChatMessage[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== "assistant") continue;
    const textBlocks = msg.content.blocks.filter(
      (b): b is TextBlock => b.type === "text",
    );
    if (textBlocks.length === 0) continue;
    const joined = textBlocks.map((b) => b.text).join("");
    if (joined.length > 0) return joined;
  }
  return undefined;
}

/**
 * 工厂：创建 `task` 工具实例。
 *
 * `Tool.description` 是静态 readonly string，因此动态可选 agent 列表通过工厂参数注入：
 * `description` 拼上可选 agent 列表（名字 + 可选描述），让 LLM 知道有哪些子 agent 能调以及各自擅长什么。
 *
 * @param availableAgents 当前 registry 中 `subagentCallable=true` 的 agent（名字 + 可选描述）
 */
export function createSubagentTool(
  availableAgents: readonly {
    readonly name: string;
    readonly description?: string;
  }[],
): Tool<TaskToolInput, TaskToolOutput, BuiltinToolContext> {
  const list =
    availableAgents.length > 0
      ? availableAgents
          .map((a) =>
            a.description != null && a.description.trim().length > 0
              ? `${a.name}：${a.description.trim()}`
              : a.name,
          )
          .join("\n")
      : "（暂无）";
  const description = `派生一个子代理执行子任务，等它跑完后把末条回复文本作为本工具的结果回流。适用于把复杂或独立子任务（如查大纲设定、生成角色档案）委派给专门的 agent，避免在主对话中累积过多上下文。

入参：
- subagentName：目标子代理 name（你可以调用的 subagent 如下：
${list}
）
- description：3-5 词任务描述（用作子会话标题）
- prompt：任务正文，写清要子代理完成什么

并行：本工具非突变工具，单条 assistant 消息里可同时发起多个 task tool_use，会并发执行各自独立子会话。

注意：子代理只能访问当前会话工作区文件（与父会话同一 VFS 视图）；它不会看到主对话的历史，仅看到你在 prompt 中提供的上下文。`;
  return {
    name: "task",
    description,
    inputSchema: z.object({
      description: z
        .string()
        .min(1)
        .describe("3-5 词任务描述（用作子会话标题）"),
      prompt: z.string().min(1).describe("任务正文，写清要子代理完成什么"),
      subagentName: z
        .string()
        .min(1)
        .describe("目标子代理 name（非 id），需为 subagentCallable=true 的 agent"),
    }),
    outputSchema: z.object({
      text: z.string(),
      subagentSessionId: z.string(),
    }),
    async run(input, ctx) {
      const subagent = ctx.subagent;
      if (subagent == null) {
        throw new ToolError(
          "FAILED",
          "task 工具未装配 subagent 上下文（当前 agent 不允许派生子代理）",
          { toolName: "task" },
        );
      }
      // 双保险：depth >= 2 时拒绝（孙 agent 的 registry 本应已 deny task，见 resolveAgentToolRegistry）。
      if (subagent.depth >= SUBAGENT_MAX_DEPTH) {
        throw new ToolError(
          "FAILED",
          `已达子代理递归上限（depth=${subagent.depth}），不允许再派生`,
          { toolName: "task" },
        );
      }

      const defs = await subagent.agentRegistry.list();
      const def = defs.find((d) => d.name === input.subagentName);
      if (def == null) {
        throw new ToolError(
          "FAILED",
          `未找到名为 "${input.subagentName}" 的子代理；可选：${defs
            .filter((d) => d.subagentCallable === true)
            .map((d) => d.name)
            .join(", ") || "（暂无）"}`,
          { toolName: "task" },
        );
      }
      if (def.subagentCallable !== true) {
        throw new ToolError(
          "FAILED",
          `子代理 "${input.subagentName}" 未开启 subagentCallable，不能被 task 调用`,
          { toolName: "task" },
        );
      }

      // 子 session title（P2-12）：description 非空优先，否则 prompt.slice(0, 40)。
      const title =
        input.description.trim().length > 0
          ? input.description
          : input.prompt.slice(0, 40);
      const childSessionId = await subagent.createChildSession(title);

      const { savedModelId, workspaceModelId } =
        subagent.resolveChildModelId(def);

      const result = await subagent.runChildAgent(def, childSessionId, {
        savedModelId,
        workspaceModelId,
        signal: subagent.parentSignal,
        maxSteps: def.runtime?.maxSteps,
      });

      // AgentRunResult 不带文本，必须自己 listBySession 拿末条 assistant text。
      const childMessages = await subagent.messages.listBySession(childSessionId);
      const lastText = extractLastAssistantText(childMessages);

      let text: string;
      if (result.stopReason === "completed" && lastText != null) {
        text = lastText;
      } else {
        // P1-7 fallback：可读失败原因，仍带上 subagentSessionId 供 UI 跳转看半成品。
        text = `[子代理未完成任务: stopReason=${result.stopReason}]`;
      }

      return { text, subagentSessionId: childSessionId };
    },
  };
}

// 静态导出 AgentDefinition 类型，方便 caller 类型推导顺手。
export type { AgentDefinition };
