/**
 * SSE `data:` 行的共享读法（前缀判定 + payload 切片）。
 *
 * @module infra/llm-protocol/logic/sse-data-line
 */

/**
 * 解析一行 SSE 的 `data:` 前缀，返回 payload；非 `data:` 行或空 payload 返回 `null`。
 *
 * ⚠️ **为什么不能用 `line.startsWith("data: ")`**：真实网关存在**无空格**形态
 * （`data:{"choices":[…]}`）。旧的三家 parser 一律用带空格的 `startsWith("data: ")`
 * 早退，于是无空格形态的每一行都被**静默丢弃**——`recordMalformedSseLine` 一次都不进，
 * `assertSseParseSucceededOrThrow` 的 `blocks.length === 0 && malformedLineCount > 0`
 * 判据不成立 ⇒ 不抛错、不重试、无日志 ⇒ run 以「（本次生成无内容输出）」占位正常收尾，
 * 用户看到的是「秒回一条空消息」。
 *
 * SSE 规范规定 `data:` 之后**至多一个**空格被当分隔符吃掉，因此 `slice(5)` 覆盖
 * 「无空格」与「一个空格」两种形态，再 `.trim()` 吃掉 CRLF 残留（CRLF 兼容是既有行为，
 * 非本条引入）。
 *
 * @param line 单行（已由 `feedSseLines` 切分，不含换行符）
 * @returns payload 字符串；非 `data:` 行、空行、空 payload 返回 `null`
 */
export function parseSseDataLine(line: string): string | null {
  if (!line.startsWith("data:")) {
    return null;
  }
  const payload = line.slice(5).trim();
  return payload === "" ? null : payload;
}