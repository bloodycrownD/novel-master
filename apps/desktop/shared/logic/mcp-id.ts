/**
 * MCP 服务器 ID 规则（与 core `McpServerConfigOps.isValidId` 同源正则）：renderer
 * 与 main 是两个 bundle，core 的运行时值进不了 renderer（vite 无 core alias），
 * 这里是表单校验侧的副本；core 侧（main handler / store）以 McpServerConfigOps 为值源，
 * 改正则须两处同步。
 *
 * @module logic/mcp-id
 */

/** ID 规则正则：英文字母、数字、单个下划线分隔（不含连续或首尾下划线——`__` 是 `mcp__<ID>__<tool>` 的分隔符，ID 里出现会让换 ID 的引用改写误伤别的 server）。 */
export const MCP_ID_PATTERN = /^[A-Za-z0-9]+(_[A-Za-z0-9]+)*$/;

/** ID 判定（先剥边缘空白）；非法时 UI 用 settings.mcp.validation.id_invalid 文案。 */
export const McpId = {
    // nm-style: keep-public — renderer 跨 bundle 的 ID 规则契约副本（main / renderer 不能值引用 core），表单按名字调用而不是各自复制正则
    isValid: (id: string): boolean => {
        const trimmed = id.trim();
        return trimmed !== "" && MCP_ID_PATTERN.test(trimmed);
    },
} as const;
