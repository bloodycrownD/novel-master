/**
 * Token counter kind → UI 标签映射。
 *
 * 「自动」吸收了三种语义：API cache 命中（精确值）、heuristic 估算兜底（字符比）、
 * 以及 savedModelId 缺失时的纯字符估算（仍归入 heuristic）。
 * 具体 tokenizer 名（tiktoken / claude / llama3 / mistral / ...）原样显示。
 *
 * @module infra/tokenizer/logic/format-counter-kind-label
 */

export function formatCounterKindLabel(counterKind: string): string {
  if (counterKind === "api" || counterKind === "heuristic") return "自动";
  return counterKind;
}
