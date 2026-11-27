/**
 * MCP 工具缓存条目模型（总体方案 B）：工具定义是内存缓存，只在「连接」（握手 +
 * tools/list）成功时整体替换，没有过期时间；读配置 / 状态 / 缓存都不联网。
 * server 级失败只从 {@link McpServerStatus} 读出：`cachedTools()` 对失败、撞名
 * 与从未连上的 server 只是跳过，缓存条目里没有它们的工具。
 *
 * @module domain/mcp/model/mcp-tool-snapshot
 */

import type { McpFailure } from "./mcp-failure.js";

/** 单个 MCP 工具的缓存条目（`McpToolAdapter.toNmTool` 的装配期输入）。 */
export interface McpToolSnapshot {
    readonly serverId: string;
    /** MCP 侧原始工具名（未 slug；callTool 用它）。 */
    readonly toolName: string;
    /** MCP 工具描述；缺省时 toNmTool 回落 toolName。 */
    readonly toolDescription?: string;
    /** MCP server 在 tools/list 里声明的入参 JSON Schema；原样给模型看（校验仍交给 server）。缺省或不是对象时模型看到空参数定义。 */
    readonly inputSchema?: Readonly<Record<string, unknown>>;
}

/** server 状态（UI 状态标签与「测试连接」口径）。 */
/** pending = 启用但从未尝试连接；connecting = 一次尝试进行中；failed = 从未连上过（或撞名标记），界面不自动重试；disconnected = 曾连上、调用时重连失败，工具缓存保留，进页面会再试。 */
export type McpServerState = "ready" | "failed" | "disconnected" | "unsupported" | "disabled" | "pending" | "connecting";

/** server 级状态：连接管理器同步读；双端的状态标签与错误原文展示都消费它。 */
export interface McpServerStatus {
    readonly serverId: string;
    readonly state: McpServerState;
    readonly toolCount?: number;
    readonly failure?: McpFailure;
    readonly lastConnectedAt?: number;
}
