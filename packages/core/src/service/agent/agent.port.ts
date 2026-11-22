/**
 * Agent runner port.
 *
 * @module service/agent/agent.port
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { AgentRunResult } from "@/domain/agent/model/agent-run-result.js";
import type { AbortScope } from "@/domain/abort/model/abort-scope.js";
import type { LlmStreamEvent } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

export interface AgentRunOptions {
    readonly definition: AgentDefinition;
    readonly sessionId: string;
    readonly projectId: string;
    /** Resolved saved model UUID (host reads state/flags; Core does not). */
    readonly savedModelId: string;
    /** Workspace current model id. */
    readonly workspaceModelId: string;
    readonly maxSteps?: number;
    readonly stream?: boolean;
    readonly onStream?: (event: LlmStreamEvent) => void;
    /** When false, assistant/tool turns are kept in an ephemeral overlay only
   * ({@link EphemeralOverlayAgentSession}); default true. */
    readonly persistMessages?: boolean;
    /** When false, skip `agent.run.*` / stream bus events; default true. */
    readonly publishRunLifecycle?: boolean;
    /**
   * 取消作用域：调用方 UI / runtime 的中断经它级联进本 run。
   *
   * 缺省（CLI / 测试直接调用）视为不可取消；`run-agent-turn` 总会传入根 scope。
   */
    readonly scope?: AbortScope;
}

/** Drives multi-step model round-trips with tool execution. */
export interface AgentRunner {
    /**
   * 已知失败沿返回值（五期门⑦）：`Result.err(AppError)` 携带失败（FAILED 事件、
   * 失败消息落库等收尾已在 runner 内完成）；取消不是失败——`Outcome.cancelled`
   * 路由进 `handleAbort` 后以 `stopReason:"cancelled"` 正常返回 Ok。非 AppError
   * 的未知异常仍抛，由入口壳（run-agent-turn）catch 收口。
   */
    run(options: AgentRunOptions): Promise<Result<AgentRunResult, AppError>>;
}
