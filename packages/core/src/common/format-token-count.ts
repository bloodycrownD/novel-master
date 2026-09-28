/**
 * 紧凑的 token 数量与 usage 标签格式化（跨端共用）。
 *
 * 大数值会用 K / M 后缀压缩（例如 2500 → "2.5K"），避免 UI 上挤一长串数字。
 * `formatContextUsageLabel` 在已知 context window 时会输出「记号 =/≈ 百分比
 * 占比」形式（`远程 = 42% 55/128K`），未知时退回纯计数（`gpt ≈ 2.3K tokens`）。
 *
 * `formatTokenSourceBadge`（占用来源 → 记号 + 连接符）是这套标签的唯一事实
 * 来源：实现放在本文件（common）是为了让 mobile 在整体 mock `core/provider`
 * 的 jest 套件里也能经 `core/common` 直取真实现，`infra/tokenizer/logic/
 * format-token-source-badge.ts` 与 `public/provider` 只是它的具名再导出。
 *
 * desktop renderer 因 X1 门禁不能 import core，那边在
 * `apps/desktop/shared/logic/format-token-count.ts` 维护等价镜像，
 * 改动本文件时须同步那份（两份注释互指）。
 */

/** token 占用标签的来源记号：`mark`（源/家族展示名）+ `connector`（精确 = / 估算 ≈）。 */
export interface TokenSourceBadge {
  readonly mark: string;
  readonly connector: "=" | "≈";
}

/**
 * 家族展示名映射：counterKind → 标签上的记号。
 *
 * tiktoken / gpt2 家族在标签上统一记作 gpt（两族共享 BPE 词表体系，gpt2 实际
 * 不可达——node 端报 tiktoken、rn 端报 heuristic，映射纯防御）；qwen2 / llama3 /
 * command-r 去掉代次后缀；其余家族原样。未知 counterKind（未来新增家族）不在此
 * 表内，落 `?? counterKind` 原样透传。
 */
const TOKENIZER_FAMILY_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  tiktoken: "gpt",
  gpt2: "gpt",
  qwen2: "qwen",
  llama3: "llama",
  "command-r": "command",
};

/**
 * 占用来源（source）+ 分词器档位（counterKind/estimated）→ 标签记号映射：
 *
 * - `source=api` → `远程 =`（上次 completed run 的 `usage.prompt_tokens` 真值；
 *   不变式：api ⇒ estimated:false 且 counterKind:api）。
 * - `counterKind=heuristic` → `gpt ≈`——一切兜底档同显此行：cl100k 兜底与字符
 *   折算终极档合并（2026-09-28 拍板：三元组无法区分两者，区分收益低）。
 * - 家族名 + est=false → `家族展示名 =`（精确档）。
 * - 家族名 + est=true → `gpt ≈`（防御：fallback-caliber-align 修复后该态消失，
 *   资产失败回潮时诚实标注估算而非谎报家族精确）。
 * - 未知 counterKind → mark 原样透传（防御未来家族），est=false 仍按精确 `=`。
 */
export function formatTokenSourceBadge(
  source: "api" | "local" | undefined,
  counterKind: string,
  estimated: boolean,
): TokenSourceBadge {
  if (source === "api") {
    return { mark: "远程", connector: "=" };
  }
  if (counterKind === "heuristic") {
    return { mark: "gpt", connector: "≈" };
  }
  if (estimated) {
    return { mark: "gpt", connector: "≈" };
  }
  const display = TOKENIZER_FAMILY_DISPLAY_NAMES[counterKind];
  return { mark: display ?? counterKind, connector: "=" };
}

/**
 * 完整上下文占用标签：`{mark} {connector} {pct}% {cur}/{cw}`（已知窗口）或
 * `{mark} {connector} {X} tokens`（未知窗口）。badge 缺省时退化为无前缀形态
 * （`{pct}% {cur}/{cw}` / `{X} tokens`）。pct 封顶 999；非法 count 显示 `—`。
 */
export function formatContextUsageLabel(
  count: number,
  contextWindow?: number,
  badge?: TokenSourceBadge,
): string {
  const prefix = badge != null ? `${badge.mark} ${badge.connector} ` : "";
  if (!Number.isFinite(count) || count < 0) {
    return `${prefix}—`;
  }
  const current = formatTokenCount(count);
  if (contextWindow == null || contextWindow <= 0) {
    return `${prefix}${current} tokens`;
  }
  const pct = Math.min(999, Math.round((count / contextWindow) * 100));
  return `${prefix}${pct}% ${current}/${formatTokenCount(contextWindow)}`;
}

/**
 * 兼容名：与 {@link formatContextUsageLabel} 同一实现（token-source-label 收敛
 * 后旧调用方的迁移入口；不再有 `~` 前缀与 estimated 参数）。
 */
export const formatPromptTokenUsageLabel = formatContextUsageLabel;

function trimTrailingZeros(s: string): string {
  return s.replace(/\.0$/, "");
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "—";
  }
  const rounded = Math.round(n);
  if (rounded < 1000) {
    return String(rounded);
  }
  if (rounded < 1_000_000) {
    const k = rounded / 1000;
    if (k >= 100) {
      return `${Math.round(k)}K`;
    }
    return `${trimTrailingZeros(k.toFixed(1))}K`;
  }
  const m = rounded / 1_000_000;
  if (m >= 100) {
    return `${Math.round(m)}M`;
  }
  return `${trimTrailingZeros(m.toFixed(1))}M`;
}
