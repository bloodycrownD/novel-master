/**
 * Chat-backed agent session (SQLite via MessageService).
 *
 * @module service/agent/impl/chat-agent-session
 */

import type { MessageContent } from "@/domain/chat/model/message.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { MessageUsage } from "@/domain/chat/model/message-usage.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";

/**
 * Agent session adapter over {@link MessageService}.
 *
 * workplaceScopeSessionId 决定规则评估与 workplace 服务的 scope：主 session 等于
 * 自身；子 session 指向父 session（子 agent 在父 session 工作区工作）。
 * kkvScopeSessionId 决定 rule_snapshot / file_cache 的 KKV 归属：永远等于自身
 * sessionId（子会话仅做规则快照隔离）。runChildAgent 装配子 agent 时显式传入
 * parentSessionId 作为第三位位置参数，第四位走默认值（= childSessionId）。
 */
export class ChatAgentSession implements AgentSession {
  constructor(
    private readonly messages: MessageService,
    readonly sessionId: string,
    readonly workplaceScopeSessionId: string = sessionId,
    readonly kkvScopeSessionId: string = sessionId
  ) {}

  async list(): Promise<readonly ChatMessage[]> {
    // SQL 层滤 hidden（返回集合与原先的 JS 侧 filter 完全一致）：本方法被
    // agent-runner **每 step** 调一次，而压缩/置位后的会话里 hidden 行常占
    // 多数——全量拉回再逐条解压正文是大会话上的秒级卡顿源（与 UI 读口同款
    // 修法，2026-09-30 首字延迟排查实锤）。
    return this.messages.listBySession(this.sessionId, {
      includeHidden: false,
    });
  }

  append(
    role: string,
    content: MessageContent,
    options?: {
      provider?: string | null;
      modelName?: string | null;
      raw?: Record<string, unknown> | null;
      usage?: MessageUsage;
    }
  ): Promise<ChatMessage> {
    return this.messages.append(this.sessionId, role, content, options);
  }

  hideRange(fromSeq: number, toSeq: number): Promise<number> {
    return this.messages.hideRange(this.sessionId, fromSeq, toSeq);
  }

  truncateAfterMessage(afterMessageId: string | null): Promise<void> {
    return this.messages.truncateAfter(this.sessionId, afterMessageId);
  }
}
