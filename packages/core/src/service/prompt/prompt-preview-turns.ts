/**
 * 工具入参 JSON 的**格子预览**形态（预览 UI 专用；轮聚合已并入 `PromptBuilder.previewTurns`）。
 *
 * 直接 `numberOfLines` 截断 pretty JSON 会把结构腰斩（第一屏只剩头一个 key），
 * 看不清调用形状。这里解析后递归收缩：超长字符串值截断、超长数组截项、
 * 超深嵌套折叠，再 `JSON.stringify(value, null, 2)` 铺开——顶层（和浅层）的
 * key 结构始终完整可读。全屏正文仍走 `inputJson` 原文（本函数只服务预览）。
 *
 * @module service/prompt/prompt-preview-turns
 */

const PREVIEW_STRING_LIMIT = 120;
const PREVIEW_ARRAY_LIMIT = 6;
const PREVIEW_OBJECT_KEY_LIMIT = 40;
const PREVIEW_DEPTH_LIMIT = 4;

/** prompt 预览 turns 集合（工具入参 JSON 的格子预览）。 */
export const PromptPreviewTurns = {
    /** nm-style: keep-local — 递归辅助（内部自递归），内联只能就地重声明成闭包；作为格子预览映射独立保留。 */
    shrinkPreviewValue(value: unknown, depth: number): unknown {
        if (typeof value === "string") {
            if (value.length <= PREVIEW_STRING_LIMIT) {
                return value;
            }
            const head = value.slice(0, PREVIEW_STRING_LIMIT).replace(/\s+/g, " ");
            return `${head}…（截断，全文 ${value.length} 字）`;
        }
        if (Array.isArray(value)) {
            // 深度护栏同样盖住数组（纯数组深嵌套走不到对象分支，缺这道会栈溢出
            // 后整份原样回吐——恰好是本函数要避免的形态）。
            if (depth >= PREVIEW_DEPTH_LIMIT) {
                return "…";
            }
            const items = value.slice(0, PREVIEW_ARRAY_LIMIT).map((item) => PromptPreviewTurns.shrinkPreviewValue(item, depth + 1));
            if (value.length > PREVIEW_ARRAY_LIMIT) {
                items.push(`…另有 ${value.length - PREVIEW_ARRAY_LIMIT} 项`);
            }
            return items;
        }
        if (value != null && typeof value === "object") {
            if (depth >= PREVIEW_DEPTH_LIMIT) {
                return "…";
            }
            // 宽对象同样截断（只截数组不截 key 的话，几万 key 的平铺对象原样铺出
            // 数百 KB——clamp 只是视觉截，内存与布局照付）。
            const entries = Object.entries(value);
            const out: Record<string, unknown> = {};
            for (const [key, item] of entries.slice(0, PREVIEW_OBJECT_KEY_LIMIT)) {
                out[key] = PromptPreviewTurns.shrinkPreviewValue(item, depth + 1);
            }
            if (entries.length > PREVIEW_OBJECT_KEY_LIMIT) {
                out[`…另有 ${entries.length - PREVIEW_OBJECT_KEY_LIMIT} 个字段`] = "…";
            }
            return out;
        }
        return value;
    },

    /** tool use 格子预览：保结构截大 key（`inputJson` 退化形态原样返回）。 */
    formatToolUsePreviewJson(inputJson: string): string {
        try {
            const parsed: unknown = JSON.parse(inputJson);
            if (parsed == null || typeof parsed !== "object") {
                return inputJson;
            }
            return JSON.stringify(PromptPreviewTurns.shrinkPreviewValue(parsed, 0), null, 2);
        } catch {
            return inputJson;
        }
    },
} as const;
