/**
 * `task` 工具实现：主 agent 在对话回合内通过工具调用派生子 agent 执行子任务。
 *
 * 数据流（SPEC agent-subagent 总体方案）：
 *   1. `agentRegistry.list()` → `find(name === subagentName)` → `AgentDefinition`
 *      （校验 `mode !== "primary"`，排除主 agent 自身防自递归）
 *   2. `createChildSession(title = input.description ?? input.prompt.slice(0, 40))`
 *   3. `resolveChildModelId(def)` → savedModelId（子 pin → 父 savedModelId → 报错）
 *   4. `runChildAgent(def, childSessionId, opts)`（内部派生 AbortController）
 *   5. `messages.listBySession(childSessionId)` 取末条 assistant text
 *      （`AgentRunResult` 不带文本，必须自己 listBySession）
 *   6. fallback（P1-7）：`result.stopReason !== "completed"` 或末条 assistant 无 text block
 *      时，`text` 返回 `[子代理未完成任务: stopReason=...]`，`subagentSessionId` 仍填上
 *   7. 返回 `{ text, subagentSessionId: childSessionId }`（P0-1 方案 B）
 *
 * 静态内置工具：`description` 是 `(ctx) => string` 的 lambda，运行时由
 * `toolsFromRegistry` 求值。装配期 `runAgentTurn`/`runChildAgent` 预算好候选
 * subagent 名单塞进 `ctx.subagent.callableAgents`，description 从这里拼文案。
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
  /** 目标 subagent 的 name（非 UUID id）；指向 registry 中 `mode !== "primary"` 的 agent。 */
  readonly subagentName: string;
}

/**
 * `task` 工具输出（P0-1 方案 B）：text 回流给主 agent LLM，subagentSessionId 是 UI-only。
 *
 * 中断回流（phase-1-abort-reflow）：子 agent 被用户停止（stopReason=cancelled）时，
 * 额外带上 `stopped: true` 与 `failureReason`，让 `buildToolResultBlock` 能把这条
 * tool_result 标成 `ok: false`，主 agent 才能区分「用户停止」和「工具崩溃」。
 */
export interface TaskToolOutput {
  readonly text: string;
  readonly subagentSessionId: string;
  /** 子 agent 被用户中断时为 true（对应 stopReason=cancelled）。 */
  readonly stopped?: boolean;
  /** 中断原因文案（目前固定为 {@link SUBAGENT_STOP_REASON_USER}）。 */
  readonly failureReason?: string;
}

/**
 * 子 agent 被用户停止时回流的失败原因常量（phase-1-abort-reflow）。
 *
 * run 返回值 / outputSchema 描述 / 单测三处统一引用本常量，避免文案散落漂移。
 */
export const SUBAGENT_STOP_REASON_USER = "用户停止";

/** 递归上限：depth >= 2（孙 agent）不允许调用 task（已被 registry 层 deny，双保险）。 */
const SUBAGENT_MAX_DEPTH = 2;

/**
 * 从装配期预算好的候选列表拼给 LLM 看的「可选 subagent 名单」文案。
 *
 * 候选来自 `ctx.subagent?.callableAgents ?? []`：装配段已过滤掉
 * `mode === "primary"` 的主 agent、排除当前 agent 自身，至少含内置 `general`。
 */
function formatCallableList(
  callable: readonly { readonly name: string; readonly description?: string }[],
): string {
  if (callable.length === 0) return "（暂无）";
  return callable
    .map((a) =>
      a.description != null && a.description.trim().length > 0
        ? `${a.name}：${a.description.trim()}`
        : a.name,
    )
    .join("\n");
}

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
 * 静态 `task` 工具实例。
 *
 * description 是 lambda：从 `ctx.subagent?.callableAgents` 读装配期预算好的
 * 候选列表拼文案，让 LLM 知道有哪些子 agent 能调以及各自擅长什么。
 * run() 内查找目标 def 时再叠加 `mode !== "primary"` 过滤，防主 agent 被当子 agent 调。
 */
export const subagentTool: Tool<
  TaskToolInput,
  TaskToolOutput,
  BuiltinToolContext
> = {
  name: "task",
  description: (ctx) => {
    const callable = ctx.subagent?.callableAgents ?? [];
    return `派生一个子代理执行子任务，等它跑完后把末条回复文本作为本工具的结果回流。适用于把复杂或独立子任务（如查大纲设定、生成角色档案）委派给专门的 agent，避免在主对话中累积过多上下文。

入参：
- subagentName：目标子代理 name（你可以调用的 subagent 如下：
${formatCallableList(callable)}
）
- description：3-5 词任务描述（用作子会话标题）
- prompt：任务正文，写清要子代理完成什么

并行：本工具非突变工具，单条 assistant 消息里可同时发起多个 task tool_use，会并发执行各自独立子会话。

注意：子代理只能访问当前会话工作区文件（与父会话同一 VFS 视图）；它不会看到主对话的历史，仅看到你在 prompt 中提供的上下文。`;
  },
  inputSchema: z.object({
    description: z
      .string()
      .min(1)
      .describe("3-5 词任务描述（用作子会话标题）"),
    prompt: z.string().min(1).describe("任务正文，写清要子代理完成什么"),
    subagentName: z
      .string()
      .min(1)
      .describe("目标子代理 name（非 id），需为 mode 非 primary 的 agent"),
  }),
  outputSchema: z.object({
    text: z.string(),
    subagentSessionId: z.string(),
    // 中断回流（phase-1-abort-reflow）：cancelled 时才有值，故可选。
    stopped: z.boolean().optional(),
    failureReason: z.string().optional(),
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
    // mode !== "primary" 过滤：主 agent（mode=primary）不能被当子 agent 调，防自递归。
    const def = defs.find(
      (d) => d.name === input.subagentName && d.mode !== "primary",
    );
    if (def == null) {
      const callableNames = defs
        .filter((d) => d.mode !== "primary")
        .map((d) => d.name);
      throw new ToolError(
        "FAILED",
        `未找到名为 "${input.subagentName}" 的子代理；可选：${callableNames.join(", ") || "（暂无）"}`,
        { toolName: "task" },
      );
    }

    // 子 session title（P2-12）：description 非空优先，否则 prompt.slice(0, 40)。
    // 统一 trim，与 mobile 侧 pendingSubagentSessions 的 title 匹配逻辑保持一致。
    const trimmedDesc = input.description.trim();
    const title = trimmedDesc.length > 0 ? trimmedDesc : input.prompt.trim().slice(0, 40);
    const childSessionId = await subagent.createChildSession(title);

    const { savedModelId, workspaceModelId } =
      subagent.resolveChildModelId(def);

    const result = await subagent.runChildAgent(def, childSessionId, {
      savedModelId,
      workspaceModelId,
      signal: subagent.parentSignal,
      maxSteps: def.runtime?.maxSteps,
      prompt: input.prompt,
    });

    // AgentRunResult 不带文本，必须自己 listBySession 拿末条 assistant text。
    const childMessages = await subagent.messages.listBySession(childSessionId);
    const lastText = extractLastAssistantText(childMessages);

    // 中断回流（phase-1-abort-reflow）：cancelled 单独走「用户停止」分支，
    // 不再套 [子代理未完成任务] 文案——主 agent 要能区分「用户主动停」和「工具崩了」。
    // text 取值边界：cancelled 时 lastText 可能为空（LLM 还没吐字），固定占位文案，
    // 不能用空串吞掉回流，否则主 agent 会收到一个内容为空的 tool_result。
    if (result.stopReason === "cancelled") {
      return {
        text: lastText ?? "[用户停止，无已生成文本]",
        subagentSessionId: childSessionId,
        stopped: true,
        failureReason: SUBAGENT_STOP_REASON_USER,
      };
    }

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

// 静态导出 AgentDefinition 类型，方便 caller 类型推导顺手。
export type { AgentDefinition };
