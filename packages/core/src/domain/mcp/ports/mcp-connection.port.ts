/**
 * MCP 连接管理 port（总体方案 B/C）：连接状态机的两个读取面（工具缓存与 server
 * 状态）、三个连接入口（进页面 / 显式动作 / 调用时重连）、调用通道，以及双端共用
 * 的两个 OAuth 回调接缝。实现由 infra/mcp/impl/create-mcp-connection-manager
 * 装配；server 级失败只能从 `serverStatuses()` 读出。
 *
 * @module domain/mcp/ports/mcp-connection.port
 */

import type { Result } from "@/errors/either.js";
import type { AppError } from "@/errors/app-error.js";
import type { Interrupt } from "@/errors/outcome.js";
import type { McpFailure } from "../model/mcp-failure.js";
import type { McpServerStatus, McpToolSnapshot } from "../model/mcp-tool-snapshot.js";

/** MCP 连接管理器：连接状态机 + 工具缓存 + 失败隔离（状态与缓存语义见总体方案 B）。 */
export interface McpConnectionManager {
    /** 装配读取面（给 agent 用）：只读缓存，同步，不建连不发请求。只返回「启用、传输受支持、未撞名、未处于 failed」服务器的、未被 deps.disabledTools 关掉的工具。 */
    cachedTools(): readonly McpToolSnapshot[];
    /** 详情页工具卡读取面（给 UI 用）：原样返回一台服务器缓存里的全部工具，不过滤开关、不看连接状态、不跑撞名检测。从没连过或已作废返回空数组。 */    serverTools(serverId: string): readonly McpToolSnapshot[];
    /** 进页面触发：对每个启用服务器只看本地状态，pending / disconnected 并发发起后台连接，其余不动。返回的 Promise 在「本次发起的尝试」以及「撞上的进行中尝试」都结束后才 resolve（永不 reject）；聊天页可以不等，配置页等它来刷新状态。 */
    connectUnconnected(): Promise<void>;
    /** 显式动作（开关打开 / 保存 / 测试连接 / 授权成功）：作废该服务器缓存与在途尝试，连接并等结果。serverId 不在配置里属不变量破坏，走 assert。 */
    connect(serverId: string): Promise<McpServerStatus>;
    /** 同步读的 server 状态（UI 状态标签与「测试连接」唯一读取面）。 */
    serverStatuses(): readonly McpServerStatus[];
    /**
     * 调用 MCP 工具；取消沿 `Interrupt.cancelled` 返回（reason 按用户停止兜底，
     * 与 tool-runner 同口径），replaced 对 MCP 无生产者、类型上穷尽即可；已知失败
     * 沿 `Result.err` 带原文。Promise 不 reject。起点为 pending / failed 时不连接；
     * 连接级失败或会话失效重连一次并重试一次，期间工具缓存保留。
     */
    callTool(serverId: string, toolName: string, args: unknown, signal: AbortSignal): Promise<Result<unknown, McpFailure> | Interrupt>;
    /** 停用 / 删除 / 换 ID：作废（先关旧连接，不等待关闭完成），不连接。 */
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
