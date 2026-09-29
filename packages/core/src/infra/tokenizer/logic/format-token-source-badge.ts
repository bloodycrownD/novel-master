/**
 * token 占用来源记号（badge）+ 完整上下文占用标签 —— core 单源映射。
 *
 * 实现真身在 `common/format-token-count.ts`（与 `formatTokenCount` 的 K/M
 * 数字格式同文件单源；也让 mobile 在整体 mock `core/provider` 的 jest 套件里
 * 经 `core/common` 直取真实现），本文件是 `infra/tokenizer` 导出面（index →
 * public/provider）的具名再导出，供 desktop main 等已依赖 provider 入口的
 * 调用方使用。禁止 `export *`。
 *
 * 映射规则（source/counterKind/estimated 三元组 → `{mark, connector}`）：
 *
 * | 条件 | mark | connector |
 * |---|---|---|
 * | source=api | 远程 | =（api ⇒ est=false 恒成立） |
 * | counterKind=heuristic（一切 cl100k 兜底，含字符折算终极档） | gpt | ≈ |
 * | 家族名 + est=false | 家族展示名（tiktoken/gpt2→gpt、qwen2→qwen、llama3→llama、command-r→command、其余原样） | = |
 * | 家族名 + est=true（fallback-caliber-align 修复后不可达，防御保留） | gpt | ≈ |
 * | 未知 counterKind | 原样透传 | =（est=false）/ ≈（est=true） |
 *
 * @module infra/tokenizer/logic/format-token-source-badge
 */

export {
  formatTokenSourceBadge,
  formatContextUsageLabel,
  type TokenSourceBadge,
} from "../../../common/format-token-count.js";
