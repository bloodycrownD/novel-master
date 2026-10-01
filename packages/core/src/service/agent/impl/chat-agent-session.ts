/**
 * Chat-backed agent session (SQLite via MessageService).
 *
 * @module service/agent/impl/chat-agent-session
 */

import type { MessageContent } from "@/domain/chat/model/message.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { MessageUsage } from "@/domain/chat/model/message-usage.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { MessageAttachment } from "@/domain/chat/model/message-attachment.schema.js";
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
    // 可见-only 走 SQL 层过滤（`AND hidden = 0`，不解压隐藏行正文），返回集合
    // 与旧「全量 + JS filter(!hidden)」逐条等价（含顺序）。本方法被 agent-runner
    // 每 step 调一次，而压缩/置位后的会话里 hidden 行常占多数——全量拉回再逐条
    // 解压是大会话上的秒级卡顿源（千条会话 212ms → 可见 80 条 14ms；与 UI 读口
    // 同款修法，2026-09-30 首字延迟排查实锤）。
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
      /** 结构化附件：透传给 `MessageService.append`（写 `attachments_json`）。 */
      attachments?: readonly MessageAttachment[];
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
