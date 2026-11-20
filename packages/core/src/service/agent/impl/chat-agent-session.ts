/**
 * Chat-backed agent session (SQLite via MessageService).
 *
 * @module service/agent/impl/chat-agent-session
 */

import type { MessageContent } from "@/domain/chat/model/message.js";
import type { ChatMessageData } from "@/domain/chat/model/message.js";
import type { MessageUsage } from "@/domain/chat/model/message-usage.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { MessageAttachment } from "@/domain/chat/model/message-attachment.schema.js";
import { assert } from "@/common/assert.js";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";

/** {@link ChatAgentSession.append} 的消息选项（透传 `MessageService.append`）。 */
interface ChatAgentSessionAppendOptions {
  provider?: string | null;
  modelName?: string | null;
  raw?: Record<string, unknown> | null;
  usage?: MessageUsage;
  /** 结构化附件：透传给 `MessageService.append`（写 `attachments_json`）。 */
  attachments?: readonly MessageAttachment[];
}

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
  constructor(private readonly messages: MessageService, readonly sessionId: string, readonly workplaceScopeSessionId: string = sessionId, readonly kkvScopeSessionId: string = sessionId) {}

  async list(): Promise<readonly ChatMessageData[]> {
    // 可见-only 走 SQL 层过滤（`AND hidden = 0`，不解压隐藏行正文），返回集合
    // 与旧「全量 + JS filter(!hidden)」逐条等价（含顺序）。本方法被 agent-runner
    // 每 step 调一次，而压缩/置位后的会话里 hidden 行常占多数——全量拉回再逐条
    // 解压是大会话上的秒级卡顿源（千条会话 212ms → 可见 80 条 14ms；与 UI 读口
    // 同款修法，2026-09-30 首字延迟排查实锤）。
    // 读口改 Outcome 后此处转回数组：已知失败抛出交 runner 收口；未注入 hooks，
    // 中断分支不可达，命中即不变量破坏（断言而非取消语义）。
    const read = await this.messages.listBySession(this.sessionId, { includeHidden: false });
    if (read.kind === "failed") throw read.error;
    assert(read.kind === "completed", "ChatAgentSession.list 未注入 hooks，listBySession 不应产生中断");
    return read.value;
  }

  async append(role: string, content: MessageContent, options?: ChatAgentSessionAppendOptions): Promise<Result<ChatMessageData, AppError>> {
    // 已知失败沿返回值接力（五期门⑦）：消息仓储 `Result` 原样透传，由 agent
    // turn loop 框架级统一收口。
    return this.messages.append(this.sessionId, role, content, options);
  }

  async hideRange(fromSeq: number, toSeq: number): Promise<Result<number, AppError>> {
    return this.messages.hideRange(this.sessionId, fromSeq, toSeq);
  }

  /** nm-style: keep-public — 检查器跨类同名误判：AgentSession 端口契约方法，三个实现共享此名。 */
  async truncateAfterMessage(afterMessageId: string | null): Promise<Result<void, AppError>> {
    return this.messages.truncateAfter(this.sessionId, afterMessageId);
  }
}
