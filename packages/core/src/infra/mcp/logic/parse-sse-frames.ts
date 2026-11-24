/**
 * 整包 SSE 文本的逐帧解析（MCP transport 用，非流式——响应体完整读成文本后一次拆出）。
 *
 * 行切分与 `data:` 前缀读取复用 `infra/llm-protocol` 既有实现：`SseLineBuffer` 是增量
 * chunk 切行器（保留跨 chunk fragment、需 feed+drain），对整包文本是绕路，故按行
 * `split` 直拆；`SseDataLine.parse` 承载「无空格形态 / CRLF 残留」的案底，直接复用。
 *
 * 逐帧判定（spec「三、HTTP transport」）：合法 JSON-RPC 帧照常投递；非法帧只标记并记
 * 原文，不作废整条流。帧校验用官方 `parseJSONRPCMessage`，不自研形状判定。
 *
 * @module infra/mcp/logic/parse-sse-frames
 */

import { parseJSONRPCMessage, type JSONRPCMessage } from "@modelcontextprotocol/client";
import { SseDataLine } from "@/infra/llm-protocol/logic/sse-data-line.js";

/** 单个无法解析成 JSON-RPC 消息的帧：原文 + 失败原因（只标记，不断流）。 */
export interface SseInvalidFrame {
    readonly data: string;
    readonly error: string;
}

/** 整包 SSE 文本的解析结果。 */
export interface SseParseOutcome {
    readonly messages: readonly JSONRPCMessage[];
    readonly invalid: readonly SseInvalidFrame[];
}

export const ParseSseFrames = {
    /**
   * 把整包 SSE 文本拆成 JSON-RPC 消息。
   *
   * 空行是帧边界；`:` 开头是注释行；`event:` / `id:` / `retry:` 与未知字段行对
   * JSON-RPC 无意义，忽略但不破坏帧。同一帧内多行 `data:` 按 SSE 规范以 `\n` 拼接。
   * 整包结束时若有未以空行终结的帧，宽容补一次派发（服务器漏终结空行也不丢消息）。
   */
    parse(text: string): SseParseOutcome {
        const messages: JSONRPCMessage[] = [];
        const invalid: SseInvalidFrame[] = [];
        let dataLines: string[] = [];
        let frameStarted = false;
        const dispatchFrame = (): void => {
            if (!frameStarted) return;
            frameStarted = false;
            const payload = dataLines.join("\n");
            dataLines = [];
            try {
                messages.push(parseJSONRPCMessage(JSON.parse(payload)));
            } catch (error) {
                invalid.push({ data: payload, error: error instanceof Error ? error.message : String(error) });
            }
        };
        for (const rawLine of text.split("\n")) {
            const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
            if (line === "") {
                dispatchFrame();
                continue;
            }
            if (line.startsWith(":")) continue;
            const data = SseDataLine.parse(line);
            if (data !== null) {
                dataLines.push(data);
                frameStarted = true;
            }
        }
        dispatchFrame();
        return { messages, invalid };
    },
} as const;
