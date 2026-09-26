/**
 * 占用来源（tokenSource）→ UI 标签映射。
 *
 * `api` → 「上次请求」（值取自上一次 completed run 的 `usage.prompt_tokens`），
 * 其余一律 → 「预估」（本地 tokenizer 估算）。`undefined` 与未知取值都归入
 * 「预估」：宁可标成保守的估算值，也不要给出「这是 API 真值」的假信号。
 *
 * 与 {@link formatCounterKindLabel}（分词器维度，api/heuristic 都显示「自动」）
 * 是两义、不合并：那个说「用哪个分词器」，这个说「值从哪来」。
 *
 * 此前 desktop main service、desktop renderer 的 SessionDetailDrawer、mobile
 * service 三处各写一遍同语义三元表达式，改一处忘另两处就会出现「主进程标签与
 * chip 打架」。本函数是该映射的唯一事实来源。
 *
 * @module infra/tokenizer/logic/format-token-source-label
 */

export function formatTokenSourceLabel(
  source: "api" | "local" | undefined,
): string {
  return source === "api" ? "上次请求" : "预估";
}
