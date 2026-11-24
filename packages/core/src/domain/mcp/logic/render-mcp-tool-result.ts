/**
 * MCP CallToolResult → 纯文本（spec §六）：TextContent 拼接；image / audio /
 * resource_link / embedded resource 降级为占位文本（占位里尽量带 mimeType /
 * uri 这类零成本元数据）；embedded resource 自带 text 时直接透出原文。
 *
 * 输出是拼接全文、不在此截断——50KB 预算由 to-nm-tool 的 run 经 OverflowSink
 * 落盘（全文落盘的前提是这里不丢尾部）。未知类型输出占位说明，不 throw。
 *
 * @module domain/mcp/logic/render-mcp-tool-result
 */

import { Coerce } from "@/common/coerce.js";
import { Guards } from "@/common/guards.js";

export const McpToolResultRenderer = {
    /** content 条目数组 → 换行拼接的纯文本（条目间 `\n`；空条目过滤）。 */
    render: (content: readonly unknown[]): string =>
        content
            .map((item) => {
                if (!Guards.isRecord(item)) return "";
                const type = Coerce.strictText(item.type);
                if (type === "text") return Coerce.string(item.text);
                if (type === "image" || type === "audio") return `[${type} content omitted: ${Coerce.string(item.mimeType) || "unknown"}]`;
                if (type === "resource_link") return `[resource link: ${Coerce.string(item.uri)}]`;
                if (type === "resource") {
                    const resource = Guards.isRecord(item.resource) ? item.resource : null;
                    const text = resource == null ? null : Coerce.strictText(resource.text);
                    if (text != null) return text;
                    return `[resource content omitted: ${resource == null ? "unknown" : Coerce.string(resource.uri)}]`;
                }
                return type == null ? "[unknown content item]" : `[unknown content: ${type}]`;
            })
            .filter((piece) => piece.length > 0)
            .join("\n"),
} as const;
