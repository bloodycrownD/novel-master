/**
 * 流式正文是否启用 legacy InlineThinkingStreamSplitter（opt-in）。
 *
 * 默认关闭（直通 text-delta）；设置 `NM_INLINE_STREAM_THINKING_SPLIT=1` 可恢复旧行为。
 *
 * @module infra/llm-protocol/logic/stream-inline-thinking-split-mode
 */

let inlineStreamThinkingSplitOverrideForTests: boolean | undefined;

/** 测试专用：覆盖环境变量与全局开关。 */
export function setInlineStreamThinkingSplitForTests(
  value: boolean | undefined,
): void {
  inlineStreamThinkingSplitOverrideForTests = value;
}

/** 是否对流式 `content` / 非 thought 文本启用 per-chunk splitter。 */
export function inlineStreamThinkingSplitEnabled(): boolean {
  if (inlineStreamThinkingSplitOverrideForTests !== undefined) {
    return inlineStreamThinkingSplitOverrideForTests;
  }
  const g = globalThis as { __NM_INLINE_STREAM_THINKING_SPLIT__?: boolean };
  if (g.__NM_INLINE_STREAM_THINKING_SPLIT__ === true) {
    return true;
  }
  return process.env.NM_INLINE_STREAM_THINKING_SPLIT === "1";
}
