/**
 * 紧凑的 token 数量、usage 标签与统计页展示格式化（跨端共用）。
 *
 * 大数值会用 K / M 后缀压缩（例如 2500 → "2.5K"），避免 UI 上挤一长串数字。
 * `TokenFormat.contextUsageLabel` 在已知 context window 时会输出「记号 =/≈ 计数
 * 占比」形式（`glm = 78k / 128k (78%)`），未知时退回纯计数
 * （`gpt ≈ 2.3k tokens`）。
 *
 * `TokenFormat.sourceBadge`（占用来源 → 记号 + 连接符）是这套标签的唯一事实
 * 来源：实现放在本文件（common）是为了让 mobile 在整体 mock `core/provider`
 * 的 jest 套件里也能经 `core/common` 直取真实现，`public/provider` 只是它的
 * 具名再导出。
 *
 * desktop renderer 因 X1 门禁不能 import core，那边在
 * `apps/desktop/shared/logic/format-token-count.ts` 与
 * `apps/desktop/shared/logic/usage-stats-format.ts` 维护等价镜像，
 * 改动本文件时须同步那两份（注释互指）。
 */

/**
 * nm-style: keep-public — 导出标签函数的 badge 参数契约，跨端构造占用徽标时使用。
 *
 * 来源记号：`mark`（源/家族展示名）+ `connector`（精确 = / 估算 ≈）。
 */
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
 * 上下文占用标签专用的紧凑计数：与 {@link TokenFormat.count} 同算法，但单位
 * 字母小写（`7.1k` / `2m`）。仅标签内使用；统计页卡片等场景仍走大写 K/M。
 *
 * nm-style: keep-local — 签名审计十五期判定**不收进 `common/number`**：它不是独立
 * 数值格式化，而是本文件 `count()` 的单位大小写变体；挪过去会让 `Number` 反向依赖
 * `TokenFormat`，或者复制一套 K/M 阈值（那是新增重复，不是收敛）。
 */
function labelCount(n: number): string {
    return TokenFormat.count(n).replace(/[KM]$/, (unit) => unit.toLowerCase());
}

function trimTrailingZeros(s: string): string {
    return s.replace(/\.0$/, "");
}

export const TokenFormat = {
    /** 统计页计数：非负有限数 → K/M 压缩（`2500` → `"2.5K"`）；非法值 → `—`。 */
    count: (n: number): string => {
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
    },

    /**
     * 完整上下文占用标签：`{mark} {connector} {cur} / {cw} ({pct}%)`（已知窗口，
     * 2026-09-29 用户拍板格式，例如 `glm = 78k / 128k (78%)`）或
     * `{mark} {connector} {X} tokens`（未知窗口）。badge 缺省时退化为无前缀形态。
     * 本标签内的数量单位用小写 k/m（与统计页大写 K 的 {@link TokenFormat.count} 区分，
     * 标签视觉更轻）；pct 封顶 999；非法 count 显示 `—`。
     */
    contextUsageLabel: (count: number, contextWindow?: number, badge?: TokenSourceBadge): string => {
        const prefix = badge != null ? `${badge.mark} ${badge.connector} ` : "";
        if (!Number.isFinite(count) || count < 0) {
            return `${prefix}—`;
        }
        const current = labelCount(count);
        if (contextWindow == null || contextWindow <= 0) {
            return `${prefix}${current} tokens`;
        }
        const pct = Math.min(999, Math.round((count / contextWindow) * 100));
        return `${prefix}${current} / ${labelCount(contextWindow)} (${pct}%)`;
    },

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
    sourceBadge: (source: "api" | "local" | undefined, counterKind: string, estimated: boolean): TokenSourceBadge => {
        if (source === "api") {
            return {mark: "远程", connector: "="};
        }
        if (counterKind === "heuristic" || estimated) {
            return {mark: "gpt", connector: "≈"};
        }
        const display = TOKENIZER_FAMILY_DISPLAY_NAMES[counterKind];
        return {mark: display ?? counterKind, connector: "="};
    },

    /** 请求流水时间：MM-DD HH:mm（本地时区）。 */
    requestTime: (ms: number): string => {
        const d = new Date(ms);
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        return `${month}-${day} ${hh}:${mm}`;
    },

    /** 耗时/首字延迟展示：秒级 x.x s / 毫秒级 xxx ms；无数据显示横杠。 */
    durationMs: (ms: number | null): string => {
        if (ms == null) {
            return "—";
        }
        return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
    },

    /** 页码条窗口：总页数 ≤7 全展示；否则首尾页 + 当前页 ±1，间隙用省略号。 */
    pageWindow: (current: number, totalPages: number): (number | "…")[] => {
        if (totalPages <= 7) {
            return Array.from({length: totalPages}, (_, i) => i + 1);
        }
        const items: (number | "…")[] = [1];
        const lo = Math.max(2, current - 1);
        const hi = Math.min(totalPages - 1, current + 1);
        if (lo > 2) {
            items.push("…");
        }
        for (let p = lo; p <= hi; p += 1) {
            items.push(p);
        }
        if (hi < totalPages - 1) {
            items.push("…");
        }
        items.push(totalPages);
        return items;
    },
} as const;
