/**
 * MCP 配置页共享小件：新建哨兵与 server 状态标签的文案选择（与 search-engine-meta 同款做法）。
 */

import type { McpServerStatus } from "@shared/ipc-types";
import { settingsTranslator } from "../../i18n/settings";

/** 新建 server 的哨兵 id（detail viewId 复用，编辑态以它区分 create 模式）。 */
export const NEW_MCP_SERVER_SENTINEL = "__new-mcp__";

/**
 * server 状态标签：带 failure 时直接显示 failure.detail（core 连接管理器的事实提示，不自写文案）；
 * ready 拼接工具数；failed / unsupported 在连接管理器里必带 failure，无 failure 的非 ready 态按未连接处理。
 */
export function mcpStatusLabel(status: McpServerStatus): string {
    if (status.failure != null) return status.failure.detail;
    if (status.state === "ready") return `${settingsTranslator({ key: "settings.mcp.list.connected" })} · ${settingsTranslator({ key: "settings.mcp.list.tool_count", params: { count: status.toolCount ?? 0 } })}`;
    if (status.state === "connecting") return settingsTranslator({ key: "settings.mcp.list.connecting" });
    if (status.state === "disabled") return settingsTranslator({ key: "settings.mcp.detail.status_disabled" });
    return settingsTranslator({ key: "settings.mcp.detail.status_pending" });
}

