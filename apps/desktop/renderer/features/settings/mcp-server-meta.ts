/**
 * MCP 配置页共享小件：新建哨兵与 server 状态标签的文案选择（与 search-engine-meta 同款做法）。
 */

import type { McpServerStatus } from "@shared/ipc-types";
import { mcpT } from "../../i18n/settings";

/** 新建 server 的哨兵 id（detail viewId 复用，编辑态以它区分 create 模式）。 */
export const NEW_MCP_SERVER_SENTINEL = "__new-mcp__";

/** server 状态标签：ready 带 toolCount；错误原文（failure.detail）由调用方另行展示，不进标签。 */
export function mcpStatusLabel(status: McpServerStatus): string {
    switch (status.state) {
        case "ready":
            return mcpT({ key: "mcp.state.ready", params: { count: status.toolCount ?? 0 } });
        case "failed":
            return mcpT({ key: "mcp.state.failed" });
        case "unsupported":
            return mcpT({ key: "mcp.state.unsupported" });
        case "disabled":
            return mcpT({ key: "mcp.state.disabled" });
        case "pending":
            return mcpT({ key: "mcp.state.pending" });
    }
}

/** 状态标签的色调类（settings-tag 变体）；pending / disabled 中性、ready 绿、failed / unsupported 暖。 */
export function mcpStatusTagClass(state: McpServerStatus["state"]): string {
    if (state === "ready") return "settings-tag settings-tag--ok";
    if (state === "failed" || state === "unsupported") return "settings-tag settings-tag--warn";
    return "settings-tag settings-tag--muted";
}
