/**
 * LLM response usage field parsers (OpenAI, Anthropic, Gemini shapes).
 *
 * 三家差异全部是数据：根位置、字段名、total 形态、cache 落点、早退判据。
 *
 * @module infra/llm-protocol/logic/usage-parser
 */

import { Guards } from "@/common/guards.js";
import type { LlmProtocolKind, LlmTokenUsage } from "../ports/adapter.port.js";

/** 各协议 usage 的字段落点（声明式，无独有算法）。 */
type UsageShape = {
    /** 承载 usage 的根路径候选（按序取第一个 record；Anthropic 兼容流式 message.usage）。 */
    readonly roots: readonly (readonly string[])[];
    readonly prompt: readonly string[];
    readonly completion: readonly string[];
    /** total 路径；"sum" = prompt + completion（两者都非缺席时派生）。 */
    readonly total: readonly string[] | "sum";
    readonly cacheRead?: readonly string[];
    /** cache_creation 双形态：嵌套父对象在场时只读嵌套键，否则回退扁平键。 */
    readonly cacheCreation?: { readonly nested: readonly string[]; readonly flat: readonly string[] };
    /** 早退判据：这些字段全部缺席时返回 undefined（派生的 total 不参与）。 */
    readonly requireAny: readonly UsageTokenField[];
};

type UsageTokenField = "prompt" | "completion" | "total";

/** Anthropic usage 字段名：解析与流 raw 合并（anthropic-sse-parser）共用同一份，防两处手抄漂移。 */
export const ANTHROPIC_USAGE_FIELDS = {
    prompt: "input_tokens",
    completion: "output_tokens",
    cacheRead: "cache_read_input_tokens",
    cacheCreationNested: "cache_creation",
    cacheCreationInput: "input_tokens",
    cacheCreationFlat: "cache_creation_input_tokens",
} as const;

const ANTHROPIC_USAGE_SHAPE: UsageShape = {
    roots: [["usage"], ["message", "usage"]],
    prompt: [ANTHROPIC_USAGE_FIELDS.prompt],
    completion: [ANTHROPIC_USAGE_FIELDS.completion],
    total: "sum",
    cacheRead: [ANTHROPIC_USAGE_FIELDS.cacheRead],
    cacheCreation: { nested: [ANTHROPIC_USAGE_FIELDS.cacheCreationNested, ANTHROPIC_USAGE_FIELDS.cacheCreationInput], flat: [ANTHROPIC_USAGE_FIELDS.cacheCreationFlat] },
    requireAny: ["prompt", "completion"],
};

const USAGE_SHAPES: Record<LlmProtocolKind, UsageShape> = {
    openai: { roots: [["usage"]], prompt: ["prompt_tokens"], completion: ["completion_tokens"], total: ["total_tokens"], cacheRead: ["prompt_tokens_details", "cached_tokens"], requireAny: ["prompt", "completion", "total"] },
    anthropic: ANTHROPIC_USAGE_SHAPE,
    gemini: { roots: [["usageMetadata"]], prompt: ["promptTokenCount"], completion: ["candidatesTokenCount"], total: ["totalTokenCount"], cacheRead: ["cachedContentTokenCount"], requireAny: ["prompt", "completion", "total"] },
};

export const UsageParser = {
    num(value: unknown): number | undefined {
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    },

    /** cache 计数：非负有限数即保留——显式 0 是供应商上报的「未命中」，落库 0 计入分母；仅字段缺失（undefined / 非有限数 / 负数）视为缺席。 */
    nonNegativeNum(value: unknown): number | undefined {
        const n = UsageParser.num(value);
        return n != null && n >= 0 ? n : undefined;
    },

    readPath(root: Record<string, unknown>, path: readonly string[]): unknown {
        let current: unknown = root;
        for (const key of path) {
            if (!Guards.isRecord(current)) {
                return undefined;
            }
            current = current[key];
        }
        return current;
    },

    /** Parses provider response usage by protocol. */
    parse(protocol: LlmProtocolKind, raw: unknown): LlmTokenUsage | undefined {
        if (!Guards.isRecord(raw)) {
            return undefined;
        }
        const shape = USAGE_SHAPES[protocol];
        const usage = shape.roots.map((path) => UsageParser.readPath(raw, path)).find((value) => Guards.isRecord(value));
        if (usage == null) {
            return undefined;
        }
        const promptTokens = UsageParser.num(UsageParser.readPath(usage, shape.prompt));
        const completionTokens = UsageParser.num(UsageParser.readPath(usage, shape.completion));
        const totalTokens = shape.total === "sum" ? (promptTokens != null && completionTokens != null ? promptTokens + completionTokens : undefined) : UsageParser.num(UsageParser.readPath(usage, shape.total));
        const present: Record<UsageTokenField, boolean> = { prompt: promptTokens != null, completion: completionTokens != null, total: totalTokens != null };
        if (!shape.requireAny.some((field) => present[field])) {
            return undefined;
        }
        const cacheReadTokens = shape.cacheRead == null ? undefined : UsageParser.nonNegativeNum(UsageParser.readPath(usage, shape.cacheRead));
        const cacheCreation = shape.cacheCreation;
        let cacheCreationTokens: number | undefined;
        if (cacheCreation != null) {
            // 嵌套父对象在场时只读嵌套键（即使嵌套键缺失也不回退），否则读扁平键。
            const nestedParent = cacheCreation.nested[0];
            cacheCreationTokens = nestedParent != null && Guards.isRecord(usage[nestedParent]) ? UsageParser.nonNegativeNum(UsageParser.readPath(usage, cacheCreation.nested)) : UsageParser.nonNegativeNum(UsageParser.readPath(usage, cacheCreation.flat));
        }
        return {
            promptTokens,
            completionTokens,
            totalTokens,
            // 仅在值存在时展开字段，保持「无 cache 字段 → 返回对象不含该二字段」的契约。
            ...(cacheReadTokens != null ? { cacheReadTokens } : {}),
            ...(cacheCreationTokens != null ? { cacheCreationTokens } : {}),
        };
    },
} as const;
