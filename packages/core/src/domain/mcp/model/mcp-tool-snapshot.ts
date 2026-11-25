/**
 * MCP 工具快照模型：装配期 `tools/list` 的缓存条目与 server 状态标签（spec §五）。
 *
 * 快照是工具 description 的唯一来源——`Tool.description` 是同步 lambda
 * （infra/llm-protocol 的 tool-definitions 同步求值），MCP 工具清单必须装配期
 * 快照、不能异步现查。server 级失败只从 {@link McpServerStatus} 读出：
 * `snapshotTools()` 对失败的 server 只是跳过，快照条目里没有它的位置。
 *
 * @module domain/mcp/model/mcp-tool-snapshot
 */

import type { McpFailure } from "./mcp-failure.js";

/** 单个 MCP 工具的快照条目（`McpToolAdapter.toNmTool` 的装配期输入）。 */
export interface McpToolSnapshot {
    readonly serverId: string;
    /** MCP 侧原始工具名（未 slug；callTool 用它）。 */
    readonly toolName: string;
    /** MCP 工具描述；缺省时 toNmTool 回落 toolName。 */
    readonly toolDescription?: string;
}

/** server 状态（UI 状态标签与「测试连接」口径）。 */
/** pending = 启用但从未尝试连接；connecting = 一次尝试进行中；failed 之后界面不自动重试。 */
export type McpServerState = "ready" | "failed" | "unsupported" | "disabled" | "pending" | "connecting";

/** server 级状态：连接管理器同步读；双端的状态标签与错误原文展示都消费它。 */
export interface McpServerStatus {
    readonly serverId: string;
    readonly state: McpServerState;
    readonly toolCount?: number;
    readonly failure?: McpFailure;
    readonly lastConnectedAt?: number;
}
