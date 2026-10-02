/**
 * `task` 工具实现：主 agent 在对话回合内通过工具调用派生子 agent 执行子任务。
 *
 * 数据流（SPEC agent-subagent 总体方案）：
 *   1. `agentRegistry.list()` → `find(name === subagentName)` → `AgentDefinition`
 *      （校验 `mode !== "primary"`，排除主 agent 自身防自递归）
 *   2. `createChildSession(title = input.description ?? input.prompt.slice(0, 40))`
 *      （`input.sessionId` 非空时改为**续用**该子会话：四态校验后直接复用，见下）
 *   2.5 `input.fileAttachment` → `attachmentsFromPaths` 物化（按规范化 seen key 去重）
 *      → **全量挂载**随子会话首条 user 消息落库；体积预算与降级由子会话自己的
 *      prepare 链（core 单源）负责，不再在此处筛选
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
import type { MessageAttachment } from "@/domain/chat/model/message-attachment.schema.js";
import {
  AttachmentPathArgumentError,
  attachmentsFromPaths,
} from "@/domain/chat/logic/scan-at-path-attachments.js";
import { ToolError } from "@/errors/tool-errors.js";
import type { Tool } from "../model/tool.js";
import type {
  BuiltinToolContext,
  BuiltinToolSubagentContext,
} from "./builtin-tool-context.js";

/**
 * 续用子会话的历史软闸（spec D7）：目标子会话消息数 > 该阈值即拒绝续用。
 *
 * 子会话**永不压缩**，历史线性增长；不设闸的话续用会把一个已经跑飞轮的历史
 * 无限拉长。超限引导「去掉 sessionId 新开」。
 */
export const TASK_SESSION_RESUME_MAX_MESSAGES = 300;

/** `task` 工具输入。 */
export interface TaskToolInput {
  /** 3-5 词任务描述，用于子 session title。 */
  readonly description: string;
  /** 给子 agent 的任务正文。 */
  readonly prompt: string;
  /** 目标 subagent 的 name（非 UUID id）；指向 registry 中 `mode !== "primary"` 的 agent。 */
  readonly subagentName: string;
  /**
   * 续用已有子会话 id（非空则不新建，直接往该子会话追加 user 消息并继续跑）。
   *
   * 留空（缺省 / 空串 / 纯空白）= 新建子会话。归属校验为**直接父**口径：
   * 目标子会话的 `parentSessionId` 必须等于当前父会话，否则拒绝。
   */
  readonly sessionId?: string;
  /**
   * 显式交付给子代理的文件路径列表（与主会话附件同链路挂 `<action name="userAttach">`）。
   *
   * 全量挂载：子会话 prepare 链（`prepareUserMessagesForPrompt`，core 单源）按
   * `ATTACH_PROMPT_CHAR_BUDGET` 计量，超限项自动降级为 filename 档引导文案。
   */
  readonly fileAttachment?: readonly string[];
}

/**
 * `task` 工具输出（P0-1 方案 B）：text 回流给主 agent LLM；subagentSessionId 同时
 * 供 UI 卡片读取与主 agent 上下文（task 全 JSON 化后随 content 回流）。
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
  callable: readonly { readonly name: string; readonly description?: string }[]
): string {
  if (callable.length === 0) return "（暂无）";
  return callable
    .map((a) =>
      a.description != null && a.description.trim().length > 0
        ? `${a.name}：${a.description.trim()}`
        : a.name
    )
    .join("\n");
}

/**
 * 从子 session 消息列表提取末条 assistant 的合并 text（按 block 顺序拼接）。
 *
 * @returns 末条 assistant 文本；不存在或无 text block 时返回 undefined。
 */
function extractLastAssistantText(
  messages: readonly ChatMessage[]
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== "assistant") continue;
    const textBlocks = msg.content.blocks.filter(
      (b): b is TextBlock => b.type === "text"
    );
    if (textBlocks.length === 0) continue;
    const joined = textBlocks.map((b) => b.text).join("");
    if (joined.length > 0) return joined;
  }
  return undefined;
}

/** 三态续用错误统一引导：去掉 sessionId 新开。 */
function resumeGuide(): string {
  return "去掉 sessionId 重新调用即可新开一个子会话。";
}

/**
 * 鸭子判别「会话不存在」——只认 `ChatError` 的 `NOT_FOUND` 语义，不看具体类。
 *
 * 用鸭子读而非 `instanceof`：`src` 与 `dist` 双份模块实例下 `instanceof` 会失效
 * （同 `isVfsError` 的理由），而 `SessionService.get` 的契约只有 code 可依赖。
 */
function isSessionNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { readonly code?: unknown }).code === "NOT_FOUND"
  );
}

/**
 * 续用目标子会话的四态前置校验（spec D2 / D7 / D8）。
 *
 * 顺序刻意如此——先判存在性（get 抛错即不存在），再判归属（直接父口径），
 * 再判活跃，最后判历史条数软闸。每态文案都引导「去掉 sessionId 新开」。
 *
 * 存在性只吞 `NOT_FOUND`（子会话真被删了）；DB 抖动等其它故障原样上抛——把它
 * 伪装成「找不到子会话」会让模型误以为该 sessionId 失效，转而去新建一个重复
 * 的子会话，把一次瞬时故障放大成历史污染。
 *
 * @returns 校验通过的子会话 id（= 请求的 id 原样）。
 * @throws {ToolError} FAILED：不存在 / 非本会话子会话 / 活跃中 / 历史超限
 * @throws 非 `NOT_FOUND` 的 `sessions.get` 原样上抛
 */
async function resolveResumeSessionId(
  sessionId: string,
  subagent: BuiltinToolSubagentContext
): Promise<string> {
  let session;
  try {
    session = await subagent.sessions.get(sessionId);
  } catch (error) {
    if (!isSessionNotFound(error)) {
      throw error;
    }
    throw new ToolError(
      "FAILED",
      `找不到子会话 "${sessionId}"（可能已被删除）。${resumeGuide()}`,
      { toolName: "task" }
    );
  }
  // 归属：直接父口径。跨 project 的会话同样因父 id 不同被拒（一条判定覆盖两种）。
  if (session.parentSessionId !== subagent.parentSessionId) {
    throw new ToolError(
      "FAILED",
      `子会话 "${sessionId}" 不是当前会话派生的子会话，不能跨会话续用。${resumeGuide()}`,
      { toolName: "task" }
    );
  }
  // 活跃中：软闸（给模型可读引导）。真正的硬互斥在 runChildAgent 的 tryRegister claim。
  if (subagent.isSessionRunActive(sessionId)) {
    throw new ToolError(
      "FAILED",
      `子会话 "${sessionId}" 正在运行中，不能同时续用。${resumeGuide()}`,
      { toolName: "task" }
    );
  }
  // 历史软闸：子会话永不压缩，消息数线性增长，超限引导新开（spec D7）。
  const existing = await subagent.messages.listBySession(sessionId);
  if (existing.length > TASK_SESSION_RESUME_MAX_MESSAGES) {
    throw new ToolError(
      "FAILED",
      `子会话 "${sessionId}" 已有 ${existing.length} 条消息（上限 ${TASK_SESSION_RESUME_MAX_MESSAGES}），续用会持续拉长历史。${resumeGuide()}`,
      { toolName: "task" }
    );
  }
  return sessionId;
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
    return `派生一个子代理执行子任务，等它跑完后回流结果。适用于把复杂或独立子任务（如查大纲设定、生成角色档案）委派给专门的 agent，避免在主对话中累积过多上下文。

入参：
- subagentName：目标子代理 name（你可以调用的 subagent 如下：
${formatCallableList(callable)}
）
- description：3-5 词任务描述（用作子会话标题）
- prompt：任务正文，写清要子代理完成什么
- sessionId（可选）：续用某个已有子会话（传上次回流结果里的 subagentSessionId）。留空则新开。续用时该子会话的历史会被保留、子代理接着上一轮继续干，适合分多步推进同一件事；注意它只属于当前会话，不能拿去续用别的会话的子代理，同一个子会话也不能并发跑。subagentName 仍需填写（决定模型与工具策略），但子代理的实际身份以子会话历史为准。
- fileAttachment（可选）：要交给子代理的文件路径列表，会像主会话附件一样把全文直接送进子会话，省得子代理再自己 read 一遍。总量过大时超出预算的文件只给文件名与分段读取引导。

结果格式：本工具回流的是一个 JSON 对象，结构为 { text, subagentSessionId, stopped?, failureReason? }。
- text：子代理的末条回复正文；若子代理被中断且还未输出文本，text 为占位文案「[用户停止，无已生成文本]」。
- stopped：为 true 表示子代理被用户中断（部分成功），此时 failureReason 字段给出原因（如「用户停止」）。text 可能是中断前的半成品，需结合 stopped 判断：stopped=true 时不要把 text 当作完整答案。
- subagentSessionId：子会话 id（UI 跳转用，也是下次 sessionId 续用的入参）。

并行：本工具非突变工具，单条 assistant 消息里可同时发起多个 task tool_use，会并发执行各自独立子会话（但同一个 sessionId 不能被并发续用）。

注意：子代理只能访问当前会话工作区文件（与父会话同一 VFS 视图）；它不会看到主对话的历史，仅看到你在 prompt 中提供的上下文与所附文件。`;
  },
  inputSchema: z.object({
    description: z.string().min(1).describe("3-5 词任务描述（用作子会话标题）"),
    prompt: z.string().min(1).describe("任务正文，写清要子代理完成什么"),
    subagentName: z
      .string()
      .min(1)
      .describe("目标子代理 name（非 id），需为 mode 非 primary 的 agent"),
    sessionId: z
      .string()
      .optional()
      .describe(
        "续用已有子会话 id（上次回流的 subagentSessionId）；留空则新开。仅限当前会话派生的子会话，且不可并发续用同一个",
      ),
    fileAttachment: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "要交付给子代理的文件路径列表（正文全文随附件送达）；超出体积预算的部分只给文件名与分段读取引导",
      ),
  }),
  outputSchema: z.object({
    text: z
      .string()
      .describe("子代理末条回复正文；被中断且未输出文本时为占位文案"),
    subagentSessionId: z.string().describe("子会话 id（UI 跳转用）"),
    stopped: z
      .boolean()
      .optional()
      .describe("true 表示子代理被用户中断，text 可能是半成品"),
    failureReason: z
      .string()
      .optional()
      .describe("中断原因（如「用户停止」），仅在 stopped=true 时出现"),
  }),
  async run(input, ctx) {
    const subagent = ctx.subagent;
    if (subagent == null) {
      throw new ToolError(
        "FAILED",
        "task 工具未装配 subagent 上下文（当前 agent 不允许派生子代理）",
        { toolName: "task" }
      );
    }
    // 双保险：depth >= 2 时拒绝（孙 agent 的 registry 本应已 deny task，见 resolveAgentToolRegistry）。
    if (subagent.depth >= SUBAGENT_MAX_DEPTH) {
      throw new ToolError(
        "FAILED",
        `已达子代理递归上限（depth=${subagent.depth}），不允许再派生`,
        { toolName: "task" }
      );
    }

    const defs = await subagent.agentRegistry.list();
    // mode !== "primary" 过滤：主 agent（mode=primary）不能被当子 agent 调，防自递归。
    const def = defs.find(
      (d) => d.name === input.subagentName && d.mode !== "primary"
    );
    if (def == null) {
      const callableNames = defs
        .filter((d) => d.mode !== "primary")
        .map((d) => d.name);
      throw new ToolError(
        "FAILED",
        `未找到名为 "${input.subagentName}" 的子代理；可选：${
          callableNames.join(", ") || "（暂无）"
        }`,
        { toolName: "task" }
      );
    }

    // 子 session title（P2-12）：description 非空优先，否则 prompt.slice(0, 40)。
    // 统一 trim，与 mobile 侧 pendingSubagentSessions 的 title 匹配逻辑保持一致。
    const trimmedDesc = input.description.trim();
    const title =
      trimmedDesc.length > 0 ? trimmedDesc : input.prompt.trim().slice(0, 40);

    // fileAttachment：只物化（attachmentsFromPaths 内部已按规范化 seen key 去重），
    // **全量挂载**——体积预算与降级收敛到 prepare 链（core 单源），子会话每 step
    // 跑同一个 prepareUserMessagesForPrompt，超限项自动降级为 filename 档引导文案。
    //
    // **整段必须排在下面 createChildSession 之前**：空串元素是 fileAttachment 唯一的
    // 硬错误，留在建会话之后抛的话，子会话已经落库且零消息——模型拿不到
    // subagentSessionId，无法清理这个孤儿子会话，重试还会再堆一个。
    let attachments: MessageAttachment[] | undefined;
    const filePaths = input.fileAttachment;
    if (filePaths != null && filePaths.length > 0) {
      let materialized: MessageAttachment[];
      try {
        materialized = attachmentsFromPaths(filePaths);
      } catch (error) {
        if (error instanceof AttachmentPathArgumentError) {
          throw new ToolError(
            "FAILED",
            `fileAttachment 路径非法：${error.message}`,
            { toolName: "task" }
          );
        }
        throw error;
      }
      attachments = materialized;
    }

    // 续用 vs 新建（spec G4）：sessionId 非空（trim 后）走四态校验后续用同一子会话，
    // 不新建；留空/纯空白一律新开（模型显式传空串等价于不传）。
    const requestedSessionId = input.sessionId?.trim() ?? "";
    const childSessionId =
      requestedSessionId.length > 0
        ? await resolveResumeSessionId(requestedSessionId, subagent)
        : await subagent.createChildSession(title);

    const { savedModelId, workspaceModelId } =
      subagent.resolveChildModelId(def);

    const result = await subagent.runChildAgent(def, childSessionId, {
      savedModelId,
      workspaceModelId,
      signal: subagent.parentSignal,
      maxSteps: def.runtime?.maxSteps,
      prompt: input.prompt,
      ...(attachments != null ? { attachments } : {}),
    });

    // AgentRunResult 不带文本，必须自己取末条 assistant text。
    // tail+role 过滤读口（limit 只数 assistant 行）：旧形态 listBySession 读整条
    // 子会话（21 列 + 逐行 parse），maxSteps 大的子代理跑几百步后每次 task 调用
    // 都重付这笔全量读。
    // ⚠️ 不能用 listBySessionTail(sid, 1)：末条 assistant 之后常压着若干条
    // tool_result 的 user 消息，会把配额吃掉。
    // limit=8 的依据：一次 assistant 回合里「无 text block 的 assistant」只出现在
    // 「该 step 只发 tool_use、没发正文」的情形，而相邻两个这样的 step 之间必夹
    // 一条 tool_result 的 user 消息（role 过滤后不占配额）⇒ 8 给了约 4 倍余量。
    // 已知差异：子代理连续 8 个 step 只发 tool_use 且更早处有正文时，改后取不到
    // 文本（走 [子代理未完成任务: …] 兜底），已由 subagent-tool-tail-read.test.ts
    // 的 T-SUB-TAIL3 钉成期望。
    const childMessages = await subagent.messages.listBySessionTailOfRole(
      childSessionId,
      { role: "assistant", limit: 8 }
    );
    const lastText = extractLastAssistantText(childMessages);

    // 中断回流（phase-1-abort-reflow）：cancelled 单独走「用户停止」分支，
    // 不再套 [子代理未完成任务] 文案——主 agent 要能区分「用户主动停」和「工具崩了」。
    // text 取值边界：cancelled 时 lastText 可能为空（LLM 还没吐字），固定占位文案，
    // 不能用空串吞掉回流，否则主 agent 会收到一个内容为空的 tool_result。
    //
    // 回流内容以结构化 JSON 给主 agent（task 工具输出本就是给 AI 看的）——
    // formatToolOutputForLlm 对 task 输出走 JSON.stringify，主 agent 从 content 里
    // 能同时拿到 stopped / failureReason / text / subagentSessionId。
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
