/**
 * MCP 服务器 ID 规则（与 core `McpServerConfigOps.isValidId` 同源正则）：renderer
 * 与 main 是两个 bundle，core 的运行时值进不了 renderer（vite 无 core alias），
 * 这里是表单校验侧的副本；core 侧（main handler / store）以 McpServerConfigOps 为值源，
 * 改正则须两处同步。
 *
 * @module logic/mcp-id
 */

/** ID 规则正则：英文字母、数字和下划线（`mcp__<ID>__<tool>` 的服务器段）。 */
export const MCP_ID_PATTERN = /^[A-Za-z0-9_]+$/;

/** ID 判定（先剥边缘空白）；非法时 UI 用 settings.mcp.validation.id_invalid 文案。 */
export const McpId = {
    isValid: (id: string): boolean => MCP_ID_PATTERN.test(id.trim()),
} as const;
