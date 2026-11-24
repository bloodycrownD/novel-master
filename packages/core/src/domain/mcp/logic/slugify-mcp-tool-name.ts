/**
 * MCP 工具名 slug（spec §六）：`mcp__<server>__<tool>` 命名空间 + 64 字符上限。
 *
 * 字符集归一到 `[a-zA-Z0-9_-]`（其余替换为 `_`）；超长时保留前缀 + `_` + 8 位
 * 十六进制短哈希（FNV-1a 前 32 bit，哈希输入是**完整的未截断名**）——64 字符是
 * OpenAI / Anthropic 的工具名硬限制。
 *
 * @module domain/mcp/logic/slugify-mcp-tool-name
 */

import { Hash } from "@/common/hash.js";

const TOOL_NAME_MAX_LENGTH = 64;
const SHORT_HASH_LENGTH = 8;
const SLUG_CHARSET_PATTERN = /[^a-zA-Z0-9_-]/g;

export const McpToolSlug = {
    /** 复合工具名：短名原样输出；超长名截到 64 字符（55 前缀 + `_` + 8 位哈希）。 */
    toolName: (serverId: string, toolName: string): string => {
        const full = `mcp__${serverId.replace(SLUG_CHARSET_PATTERN, "_")}__${toolName.replace(SLUG_CHARSET_PATTERN, "_")}`;
        if (full.length <= TOOL_NAME_MAX_LENGTH) return full;
        const shortHash = Hash.fnv1aHex16(full).slice(0, SHORT_HASH_LENGTH);
        return `${full.slice(0, TOOL_NAME_MAX_LENGTH - SHORT_HASH_LENGTH - 1)}_${shortHash}`;
    },
} as const;
