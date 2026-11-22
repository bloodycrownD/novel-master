/**
 * Node prompt token counting (`@agnai/*`, `tiktoken`) for NMTP driver.
 *
 * stream-metrics-native ④：所有**兜底**分支（heuristic 家族 / 模型名不被 tiktoken
 * 认识 / 未知家族 / 整体异常）已从字符折算 `ceil(字符数 / 3.35)` 换成**真分词器**
 * 计数（默认 cl100k，经 core 的 `countTextWithIncrementalTokenizer`）。折算对中文
 * 正文系统性低估 82%~84%，而这些分支恰恰是「信息最少、最需要保守估计」的路径。
 * 唯一保留折算的是「连 cl100k 表都建不起来」的最后一级（见 {@link PromptLlmInputCounter} 内 fallbackCount）。
 *
 * `counterKind` 在兜底档**一律仍是 `heuristic` + `estimated: true`**：cl100k 对
 * claude / glm / qwen 这类非 OpenAI 家族只是近似，报成家族级精确读数会让压缩
 * 阈值跳过 0.85 安全系数，等于拿近似值卡精确阈值。
 *
 * message-token-cache Step 3（分层挂接，主代理定稿）：本驱动只做**内存层**——
 * 入口挂 L1 整串缓存（挡无变更重复刷新），tiktoken 家族与 heuristic 兜底档的
 * 文本计数走 L2 块平面缓存（splitTextIntoChunks 逐块查/写）；**代际推进与 KKV
 * 持久化不在这里**——挂 core 读口（`resolve-current-prompt-tokens`）的本地计数
 * 分支，驱动签名零改动。WEB/SP 家族（@agnai）整串计数只挂 L1、不切块（spec：
 * node 侧这两族走 JSON 资产 / SentencePiece 模型，块粒度对它们没有意义）。
 *
 * @module count-prompt-llm-input
 */

import {
    ChunkSplitter,
    HeuristicTokenCounter,
    TokenChunkCache,
    TokenCountTools,
    TokenizerFamilyResolver,
    TokenizerTextCount,
    promptWholeCache,
    serializePromptLlmInput,
    tokenChunkCache,
    type CountPromptLlmInputParams,
    type PromptTokenCountResult,
    type TokenCounterKind,
    type TokenizerFamily,
} from "@novel-master/core/tokenizer";
import { Result, type AppError } from "@novel-master/core/errors";
import type { Tiktoken } from "tiktoken";
import { EncodingCache } from "./impl/encoding-cache.js";
import { SentencePieceFamilyCount } from "./impl/sentencepiece-token-counter.js";
import { WebFamilyCount } from "./impl/web-tokenizer-counter.js";
import { OpenAiStyleMessageCount } from "./logic/count-openai-style-message.js";

/** 与 `register.ts` 的 NODE_DRIVER_NAME 同值（L2 计数器身份段；import 会成环，故就地重复）。 */
const DRIVER_NAME = "node";

const WEB_FAMILIES: ReadonlySet<TokenizerFamily> = new Set(["claude", "llama3", "qwen2", "command-r", "command-a", "nemo", "deepseek", "glm"]);

const SP_FAMILIES: ReadonlySet<TokenizerFamily> = new Set(["llama", "mistral", "yi", "gemma", "jamba"]);

/** 最后一级降级用的字符折算计数器（仅在 cl100k 表建不起来时才会走到）。 */
const charRatioCounter = new HeuristicTokenCounter();

// nm-style 注记：文件名 count- 动词前缀，按内容主体起名（PromptLlmInputCounter）。
export namespace PromptLlmInputCounter {
    /** 单次 encode 求长（与 rn 驱动 encodedLength 同名同形收口；encoding 为共享单例只读句柄）。 */
    function encodedLength(encoding: Tiktoken, text: string): number {
        return encoding.encode(text).length;
    }

    /**
   * 块级 L2 计数：`splitTextIntoChunks(整串)` → 逐块查 L2（命中任意一代即提升）
   * → miss 块经 `countTextWithIncrementalTokenizer` 现算并写回 → 求和。
   *
   * 这是 spec 计数流程第 3 步的驱动侧实现：块 = 句末贪吃 / 软边界 / 64 上限的
   * 确定性切分（与 core golden 同源），编辑局部性（改 5 字符仅 ~2 块 miss）与
   * 跨会话内容共享（34.7% 重复块）都建立在这个粒度上。连接符已被句末贪吃自然
   * 并入块内，无需额外补偿（spec 实测误差已含此效应）。
   */
    function countChunksWithL2(text: string, scope: string, encodeText: (text: string) => number): number {
        let total = 0;
        for (const chunk of ChunkSplitter.splitText(text)) {
            const hash = TokenChunkCache.chunkHash16(chunk);
            const hit = tokenChunkCache.lookup(hash, scope);
            if (hit !== undefined) {
                total += hit;
                continue;
            }
            const count = TokenizerTextCount.count(encodeText, chunk);
            tokenChunkCache.record(hash, scope, count);
            total += count;
        }
        return total;
    }

    /**
   * 兜底计数的**唯一落点**（L2 块流程版）：真分词器（默认 cl100k，逐块查 L2）
   * → 字符折算。
   *
   * 与 stream-metrics-native ④ 的口径差异只有一层：整串一次增量计数 → 按块
   * 分别增量计数再求和（正常文本差 -0.02%~+0.35%，spec 实测；对拍用例按 1%
   * 容差迁移，见 T-TC5）。为什么兜底不再直接折算、最后一级为何仍保留折算的
   * 完整理由见模块头与原版注释——语义未动：`cl100k 表建不起来`（返回 null）
   * 是一次性降级且不进 L2（没有真分词器就没有可缓存的稳定读数）。
   */
    function fallbackCount(text: string, scope: string): number {
        const encoding = EncodingCache.getDefault();
        if (encoding == null) {
            return charRatioCounter.countText(text);
        }
        return countChunksWithL2(text, scope, (chunk) => encodedLength(encoding, chunk));
    }

    /** Full model-aware count using Node tokenizer libraries. */
    export async function count(params: CountPromptLlmInputParams): Promise<Result<PromptTokenCountResult, AppError>> {
        const { layout, ctx, savedModelId, registry } = params;
        const saved = params.savedModels == null ? null : await params.savedModels.findById(params.savedModelId.trim());
        const vendorModelId = saved != null && saved.ok && saved.value != null ? saved.value.vendorModelId : params.savedModelId;
        const override = params.tokenizerOverride ?? (await registry.getTokenizerOverride?.()) ?? "auto";
        const family = TokenizerFamilyResolver.resolve(vendorModelId, override);
        // tools 段与提示词同串计数：本地估算含 tools 才与 API 的 promptTokens
        // （本身就含 tools）可比。空 tools 时拼接为恒等（helper 返回空串）。
        const promptText = await serializePromptLlmInput(layout, ctx);
        if (!promptText.ok) return Result.err(promptText.error);
        const serialized = promptText.value + TokenCountTools.serialize(params.tools);

        // ---- L1 整串缓存（message-token-cache Step 3）----
        // 键 = 内容指纹（hashContent(整串+tools 串) 前 16 hex，与 L2 块键同口径——
        // 64 bit 碰撞在会话级 32 条 LRU 下概率可忽略，且免为 L1 单独引完整
        // hashContent 导出）× 计数器身份（模型/override/家族/驱动，任一变化换键）。
        // 驱动内部查 L1 传**空 sessionId**：键已含内容指纹，跨会话共享安全；sessionId
        // 段的会话语义由读口层（resolve-current-prompt-tokens）决定，驱动不越层。
        const scope = TokenChunkCache.buildCounterScope({
            vendorModelId,
            tokenizerOverride: override,
            tokenizerFamily: family,
            driverName: DRIVER_NAME,
        });
        const contentHash = TokenChunkCache.chunkHash16(serialized);
        const cached = promptWholeCache.lookup("", scope, contentHash);
        if (cached != null) {
            // L1 命中：内容与计数器身份都没变，口径三件套原样返回，不进任何计数路径。
            return Result.ok(pack(savedModelId, vendorModelId, family, cached.tokenCount, cached.counterKind, cached.estimated));
        }

        // 各档实际计数（L1 miss 后进入；tiktoken / 兜底档走 L2 块流程，WEB/SP 整串）。
        let tokenCount: number;
        let counterKind: TokenCounterKind;
        let estimated = false;
        try {
            if (family === "heuristic") {
                // 家族本身就解析不出（未知模型 / 用户强制 heuristic）→ 走默认 cl100k 近似。
                tokenCount = fallbackCount(serialized, scope);
                counterKind = "heuristic";
                estimated = true;
            } else if (family === "tiktoken" || family === "gpt2") {
                const tiktokenModel = TokenizerFamilyResolver.mapVendorModelIdToTiktokenModel(vendorModelId);
                // 编码表是**进程级单例**（encoding-cache）：不再每次 new + free，避免每次
                // 刷新 meta bar 都重建一整张 BPE ranks 表。代价是取到的表是共享句柄，
                // 因此这里（以及任何持有方）都不能再 `free()`。
                const encoding = EncodingCache.forModel(tiktokenModel);
                if (encoding == null) {
                    // 模型名不被 tiktoken 认识（编码表建不起来）→ 仍走真分词器近似，
                    // 只是降级到默认 cl100k，而不是退回字符折算。
                    tokenCount = fallbackCount(serialized, scope);
                    counterKind = "heuristic";
                    estimated = true;
                } else {
                    // tiktoken 精确档的 L2 组装（overhead 不丢不重是这里的硬约束）：
                    // 现有数值组装结构：`countOpenAiStyleMessages(encoding, [wrap(serialized)],
                    // model)` = perMessage + w(role) + w(serialized) + tail（w = core 包装后的
                    // encode，0301 再 +4/-1/+9）。块流程套在 **content 层**而不是复刻 overhead：
                    //
                    // ```
                    // 分块口径 = countOpenAiStyleMessages(encoding, [wrap("")], model)  // 纯 overhead
                    //         + Σ L2(块)                                               // content 分块求和
                    // ```
                    //
                    // 空串 content 的 `w("") === 0`（增量计数器空串短路、不调 encode），所以
                    // overhead 恰好等于 perMessage + w(role) + tail——公式零复刻、零漂移（将来
                    // core 公式变这里自动跟）；content 部分从 `w(serialized)` 换成块求和，正是
                    // spec 计数流程第 3 步。数值与整串口径差 ≤1%（T-TC5 对拍）。
                    const overhead = OpenAiStyleMessageCount.count(encoding, [OpenAiStyleMessageCount.wrapSerializedPromptAsSystemMessage("")], tiktokenModel);
                    tokenCount = overhead + countChunksWithL2(serialized, scope, (chunk) => encodedLength(encoding, chunk));
                    // 精确档：真 tiktoken 家族读数，counterKind 如实报 `tiktoken`。
                    counterKind = "tiktoken";
                    // cr-tok-1：强制档必须如实标 estimated。当 tiktoken 身份来自 override
                    // 强制（读口对 WEB/SP 家族传 "tiktoken"，或用户显式强制）而非模型自身
                    // 解析时，这里算的是 cl100k 对非 OpenAI 家族的**近似**，不是该家族真
                    // 分词器读数——若谎报 est:false，上层会按精确档处理：标签漏掉 `gpt ≈`、
                    // 压缩阈值跳过 0.85 保守系数、L1 还会把条目收进 pendingWrites 跨重启
                    // 落 KKV（promptWholeCache 只收精确档的约束被绕过）。判定口径：auto
                    // 下模型自身解析不出 tiktoken 家族 ⇒ 身份来自强制。gpt 系模型（auto
                    // 即 tiktoken）不受影响，仍为精确档 est:false。
                    if (family === "tiktoken" && TokenizerFamilyResolver.resolve(vendorModelId, "auto") !== "tiktoken") {
                        estimated = true;
                    }
                }
            } else if (WEB_FAMILIES.has(family)) {
                const web = await WebFamilyCount.countPrompt(family, serialized);
                tokenCount = web.count;
                // 资产加载失败时 estimated=true 且读数已退到 cl100k 近似——此时 counterKind
                // 必须跟着降级为 heuristic，否则家族名冒充精确读数，压缩阈值会跳过 0.85
                // 安全系数（fallback-caliber-align C 线：修 WEB/SP 失败分支谎报）。
                counterKind = web.estimated ? "heuristic" : family;
                estimated = web.estimated;
            } else if (SP_FAMILIES.has(family)) {
                const sp = await SentencePieceFamilyCount.countPrompt(family, serialized);
                tokenCount = sp.count;
                // SP 家族同理：加载失败 → cl100k 近似 + heuristic，不冒充家族级精确读数。
                counterKind = sp.estimated ? "heuristic" : family;
                estimated = sp.estimated;
            } else {
                // 未来新增的家族尚未接上真 tokenizer：走默认 cl100k 近似而非字符折算。
                tokenCount = fallbackCount(serialized, scope);
                counterKind = "heuristic";
                estimated = true;
            }
        } catch {
            tokenCount = fallbackCount(serialized, scope);
            counterKind = "heuristic";
            estimated = true;
        }

        // miss 后写 L1（无论哪一档——WEB/SP 整串读数同样受益于「无变更重复刷新」）。
        promptWholeCache.record("", scope, contentHash, {
            tokenCount,
            counterKind,
            estimated,
        });

        return Result.ok(pack(savedModelId, vendorModelId, family, tokenCount, counterKind, estimated));
    }

    function pack(savedModelId: string, vendorModelId: string, tokenizerFamily: TokenizerFamily, tokenCount: number, counterKind: TokenCounterKind, estimated: boolean): PromptTokenCountResult {
        return {
            tokenCount,
            counterKind,
            estimated,
            savedModelId,
            vendorModelId,
            tokenizerFamily,
        };
    }
}
