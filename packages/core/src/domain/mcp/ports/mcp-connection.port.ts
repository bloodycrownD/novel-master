/**
 * MCP 连接管理 port（spec §五/§八）：常驻懒连接、失败隔离、装配期工具快照，
 * 以及双端共用的两个 OAuth 回调接缝。实现由 infra/mcp/impl/
 * create-mcp-connection-manager（Step 8）装配；server 级失败只能从
 * `serverStatuses()` 读出。
 *
 * @module domain/mcp/ports/mcp-connection.port
 */

import type { Result } from "@/errors/either.js";
import type { AppError } from "@/errors/app-error.js";
import type { Interrupt } from "@/errors/outcome.js";
import type { McpFailure } from "../model/mcp-failure.js";
import type { McpServerStatus, McpToolSnapshot } from "../model/mcp-tool-snapshot.js";

/** MCP 连接管理器：懒连接 + 快照缓存（TTL 60s / invalidate 失效）+ 失败隔离。 */
export interface McpConnectionManager {
    /** 装配期调用（runAgentTurn 在 BuiltinTools.register 之后 await 一次）；带缓存，失败的 server 跳过；出口已按 deps.disabledTools 过滤被关掉的工具。 */
    snapshotTools(): Promise<readonly McpToolSnapshot[]>;
    /** 同步读的 server 状态（UI 状态标签与「测试连接」唯一读取面）。 */
    serverStatuses(): readonly McpServerStatus[];
    /**
     * 调用 MCP 工具；取消沿 `Interrupt.cancelled` 返回（reason 按用户停止兜底，
     * 与 tool-runner 同口径），replaced 对 MCP 无生产者、类型上穷尽即可；已知失败
     * 沿 `Result.err` 带原文。Promise 不 reject：未知异常由 settlePromise 收编。
     */
    callTool(serverId: string, toolName: string, args: unknown, signal: AbortSignal): Promise<Result<unknown, McpFailure> | Interrupt>;
    /** 失效某 server 的工具快照与在途连接（配置保存、手动刷新、换 ID 时调）：之后再回来的在途结果会被丢弃，下次 snapshotTools 重拉。 */
    invalidate(serverId: string): void;
    /** 关闭全部常驻连接并作废在途结果。回合之间连接常驻复用，不在这里关；桌面在应用退出时调（before-quit，最多等 1.5 秒），移动端在 runtime 重建前调（没有应用退出钩子，进程被回收时连接随进程结束）。 */
    closeAll(): Promise<void>;
}

/** OAuth 2.1 授权的 app → core 回调接缝（spec §八）：桌面 loopback / 移动 deep link 只调这两个入口。 */
export interface McpOAuth {
    /** 发起授权：`redirectUrl` 由调用方先定好（桌面先起本地 server 拿端口再调；start 不负责选端口）。 */
    start(serverId: string, redirectUrl: string): Promise<Result<{ readonly authorizeUrl: string }, AppError>>;
    /** 接住系统回调（code / state / error 原样透传），完成 token 交换；不自己拼请求。 */
    handleCallback(serverId: string, callback: { readonly code?: string; readonly state?: string; readonly error?: string }): Promise<Result<void, AppError>>;
}
