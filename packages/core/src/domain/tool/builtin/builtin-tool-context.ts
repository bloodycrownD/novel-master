/**
 * 内置 Agent 工具共享上下文。
 *
 * @module domain/tool/builtin/builtin-tool-context
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { SessionService } from "@/service/chat/session.port.js";
import type { AgentRunResult } from "@/domain/agent/model/agent-run-result.js";

/** `runChildAgent` 透传给子 agent run 的解析后模型信息。 */
export interface ResolveChildModelIdResult {
  readonly savedModelId: string;
  readonly workspaceModelId: string;
}

/** `runChildAgent` 接收的运行选项。 */
export interface RunChildAgentOptions {
  readonly savedModelId: string;
  readonly workspaceModelId: string;
  readonly signal: AbortSignal;
  readonly maxSteps?: number;
  /**
   * task 工具入参的 prompt 正文：run 前写进子 session 作为第一条 user 消息，
   * 使子 agent 对话历史完整（UI 浏览可见、LLM 能看到任务描述）。
   */
  readonly prompt?: string;
}

/** `task` 工具读取的子代理装配闭包；仅 depth=0/1 注入（孙 agent 无 task 工具）。 */
export interface BuiltinToolSubagentContext {
  readonly agentRegistry: AgentRegistryService;
  readonly messages: MessageService;
  readonly sessions: SessionService;
  /** 创建子 session（title 由调用方决定）；返回新 sessionId。 */
  readonly createChildSession: (title: string) => Promise<string>;
  /**
   * 派生 `AbortController`（监听父 signal 一次）并装配子 agent runner 跑完。
   *
   * 返回值 {@link AgentRunResult} 不带文本——`task` 工具跑完后自己
   * `messages.listBySession(childSessionId)` 取末条 assistant text。
   */
  readonly runChildAgent: (
    def: AgentDefinition,
    childSessionId: string,
    opts: RunChildAgentOptions,
  ) => Promise<AgentRunResult>;
  /** 解析子 agent 模型：子 pin → 父 savedModelId → 报错（不走 workspace fallback）。 */
  readonly resolveChildModelId: (
    def: AgentDefinition,
  ) => ResolveChildModelIdResult;
  /** 当前 agent 的递归深度：主 agent depth=0，子 depth=1，孙 depth=2。 */
  readonly depth: number;
  /** 父 agent run 的 abort signal；子 agent 内部派生自己的 controller 监听它。 */
  readonly parentSignal: AbortSignal;
  /**
   * 装配期预算好的候选子代理列表（name + 可选描述），
   * `task` 工具的 description lambda 从这里拼给 LLM 看的候选文案。
   * 已排除当前 agent 自身、且仅含 `mode !== "primary"` 的 agent，
   * 至少含内置 `general`，所以 task 描述始终有内容。
   */
  readonly callableAgents: readonly {
    readonly name: string;
    readonly description?: string;
  }[];
}

/** 注入到内置工具 `run()` 的运行时上下文。 */
export type BuiltinToolContext = {
  readonly vfs: VfsService;
  readonly projectId: string;
  readonly sessionId: string;
  /** 列出会话消息（含 hidden，供 chat_grep）。 */
  readonly listSessionMessages: () => Promise<readonly ChatMessage[]>;
  /**
   * 可选：`write` 成功后 upsert `file_cache` `full:{path}`。
   * `edit` / delete / rename / move **不**读写此字段。
   */
  readonly sessionKkv?: SessionKkvService;
  /**
   * 可选：仅 `task` 工具读取。vfs-tools 完全不感知。
   *
   * 主 agent run 装配 depth=0；子 agent run 装配 depth=parent+1。
   * depth >= 2 时 `resolveAgentToolRegistry` 已强制 deny `task`，
   * 故孙 agent 的 LLM 看不到 `task` 工具，不会尝试调用。
   */
  readonly subagent?: BuiltinToolSubagentContext;
};

/** @deprecated Use {@link BuiltinToolContext}. */
export type VfsToolContext = BuiltinToolContext;
