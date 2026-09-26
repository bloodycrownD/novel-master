/**
 * tools 段的稳定序列化（本地 token 估算用）。
 *
 * 背景：本地计数走的是「提示词全文序列化 → 字符比/tokenizer」这条路，而
 * tools 定义（name / description / inputSchema）是随每次请求一起发给模型、
 * 同样占上下文的一段文本。早先本地估算不数 tools，与 API 口径的
 * `promptTokens`（含 tools）天然偏小一截；本函数把 tools 段折算进同一个
 * 序列化串，让本地估算与 API 口径可比。
 *
 * 口径：只取 `name` / `description` / `inputSchema` 三个发往线上的字段，
 * 固定键序、按 registry 顺序原样序列化（同输入必得同串，便于断言与缓存）。
 *
 * **返回值可直接用 `+` 拼到提示词序列化串后面**：空数组 / undefined 返回
 * 空串（拼接即恒等，调用方无需判空）；非空时自带前导换行作分隔。各端统一
 * 调这一个函数，避免「某端漏数 tools」的漂移。
 *
 * 范围说明：UI 读口路径（`chat-prompt-tokens.service` / 压缩评估经
 * `session-prompt-input` 的可见消息）拿不到 tools 定义，本轮不补——即 UI
 * 侧的本地预估仍不含 tools，压缩评估路径（由 agent-runner 传入 tools）含。
 *
 * **恒不传 tools 的调用方不应写这行拼接**：传进来的必定是恒空串，写上只会
 * 误导读者以为口径已覆盖 tools。拿不到 tools 定义就直接不拼，口径差另行登记。
 *
 * @module infra/tokenizer/logic/serialize-tools-for-token-count
 */

import type { LlmToolDefinition } from "@/infra/llm-protocol/ports/adapter.port.js";

/**
 * 序列化 tools 段；`tools` 为空/未定义时返回空串（可直接拼接）。
 */
export function serializeToolsForTokenCount(
  tools?: readonly LlmToolDefinition[]
): string {
  if (tools == null || tools.length === 0) {
    return "";
  }
  const normalized = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
  return `\n${JSON.stringify(normalized)}`;
}
