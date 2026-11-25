/**
 * MCP 非标错误归一模型（spec §四）：7 个内部 kind + 4 个 action + 永远透出的
 * detail 原文。红线：内部码只有这 7 个、不再细分、不做厂商标定；detail 永远
 * 带原文（截断规则在 classify-mcp-failure 落地）。
 *
 * @module domain/mcp/model/mcp-failure
 */

import type { McpTransportType } from "./mcp-server-config.js";

/** 失败类别（内部码，永不细分）。 */
export type McpFailureKind = "auth" | "permission" | "rate-limit" | "server" | "protocol" | "network" | "unknown";

/** 给用户的处置动作（kind → action 固定映射在 classify-mcp-failure 落地）。 */
export type McpFailureAction = "reauthorize" | "fix-config" | "retry" | "report";

/** 一次 MCP 失败的归一形态：分类 + 处置 + 原文（可选 HTTP status）。 */
export interface McpFailure {
    readonly kind: McpFailureKind;
    readonly action: McpFailureAction;
    /** 原文（HTML 取 title + 正文前 200 字符；JSON 截 2KB），永不空串。 */
    readonly detail: string;
    readonly status?: number;
}

/** 失败模型的固定构造（spec 内写死口径的失败统一从这里出，避免各处复制字面量）。 */
export const McpFailureOps = {
    /** 传输类型不可用（stdio / sse 只归一不实现，spec §四/Step 11）：固定 kind server、action fix-config。 */
    unsupportedTransport: (type: McpTransportType): McpFailure => ({
        kind: "server",
        action: "fix-config",
        detail: `暂不支持 ${type === "sse" ? "SSE" : "stdio"} 传输，请改用 HTTP 传输`,
    }),
} as const;
