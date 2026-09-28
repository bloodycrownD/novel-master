/**
 * Node prompt token counting (`@agnai/*`, `tiktoken`) for NMTP driver.
 *
 * stream-metrics-native ④：所有**兜底**分支（heuristic 家族 / 模型名不被 tiktoken
 * 认识 / 未知家族 / 整体异常）已从字符折算 `ceil(字符数 / 3.35)` 换成**真分词器**
 * 计数（默认 cl100k，经 core 的 `countTextWithIncrementalTokenizer`）。折算对中文
 * 正文系统性低估 82%~84%，而这些分支恰恰是「信息最少、最需要保守估计」的路径。
 * 唯一保留折算的是「连 cl100k 表都建不起来」的最后一级（见 {@link fallbackCount}）。
 *
 * `counterKind` 在兜底档**一律仍是 `heuristic` + `estimated: true`**：cl100k 对
 * claude / glm / qwen 这类非 OpenAI 家族只是近似，报成家族级精确读数会让压缩
 * 阈值跳过 0.85 安全系数，等于拿近似值卡精确阈值。
 *
 * @module count-prompt-llm-input
 */

import { HeuristicTokenCounter, mapVendorModelIdToTiktokenModel, resolveTokenizerFamily, serializePromptLlmInput, serializeToolsForTokenCount, type CountPromptLlmInputParams, type PromptTokenCountResult, type TokenCounterKind, type TokenizerFamily } from "@novel-master/core/provider";
import { countTextWithDefaultEncoding, getNodeEncodingForModel } from "./impl/encoding-cache.js";
import { countSentencePieceFamilyPrompt } from "./impl/sentencepiece-token-counter.js";
import { countWebFamilyPrompt } from "./impl/web-tokenizer-counter.js";
import {
  countOpenAiStyleMessages,
  wrapSerializedPromptAsSystemMessage,
} from "./logic/count-openai-style-message.js";

const WEB_FAMILIES: ReadonlySet<TokenizerFamily> = new Set([
  "claude",
  "llama3",
  "qwen2",
  "command-r",
  "command-a",
  "nemo",
  "deepseek",
  "glm",
]);

const SP_FAMILIES: ReadonlySet<TokenizerFamily> = new Set([
  "llama",
  "mistral",
  "yi",
  "gemma",
  "jamba",
]);

/** 最后一级降级用的字符折算计数器（仅在 cl100k 表建不起来时才会走到）。 */
const charRatioCounter = new HeuristicTokenCounter();

/**
 * 兜底计数的**唯一落点**：真分词器（默认 cl100k）→ 字符折算。
 *
 * 为什么兜底不再直接折算：`ceil(字符数 / 3.35)` 是**英文**口径，对中文正文
 * （cl100k 约 1.64 token/字符，即 ≈0.61 字符/token）系统性低估 82%~84%。折算的
 * 读数还要去卡上下文窗口的压缩阈值，低估意味着「快满了还在继续写」——这正是
 * 最该避免的组合。
 *
 * 为什么最后一级仍保留折算：`countTextWithDefaultEncoding` 返回 `null` 的唯一
 * 原因是「整张编码表建不起来」（ranks 资源缺失 / 环境未就绪）。那时别无选择，但
 * 它是**一次性降级**（失败被缓存、同进程不重试），且调用方拿到的 `counterKind`
 * 仍是 `heuristic`，压缩阈值不会误以为这是家族级真分词器读数。
 */
function fallbackCount(text: string): number {
  const real = countTextWithDefaultEncoding(text);
  return real ?? charRatioCounter.countText(text);
}

async function resolveVendorModelId(
  params: CountPromptLlmInputParams,
): Promise<string> {
  if (params.savedModels != null) {
    const saved = await params.savedModels.findById(params.savedModelId.trim());
    if (saved != null) {
      return saved.vendorModelId;
    }
  }
  return params.savedModelId;
}

/** Full model-aware count using Node tokenizer libraries. */
export async function countPromptLlmInput(
  params: CountPromptLlmInputParams,
): Promise<PromptTokenCountResult> {
  const { layout, ctx, savedModelId, registry } = params;
  const vendorModelId = await resolveVendorModelId(params);
  const override =
    params.tokenizerOverride ??
    (await registry.getTokenizerOverride?.()) ??
    "auto";
  const family = resolveTokenizerFamily(vendorModelId, override);
  // tools 段与提示词同串计数：本地估算含 tools 才与 API 的 promptTokens
  // （本身就含 tools）可比。空 tools 时拼接为恒等（helper 返回空串）。
  const serialized =
    (await serializePromptLlmInput(layout, ctx)) +
    serializeToolsForTokenCount(params.tools);

  let tokenCount: number;
  let counterKind: TokenCounterKind;
  let estimated = false;

  try {
    if (family === "heuristic") {
      // 家族本身就解析不出（未知模型 / 用户强制 heuristic）→ 走默认 cl100k 近似。
      tokenCount = fallbackCount(serialized);
      counterKind = "heuristic";
      estimated = true;
    } else if (family === "tiktoken" || family === "gpt2") {
      const tiktokenModel = mapVendorModelIdToTiktokenModel(vendorModelId);
      // 编码表是**进程级单例**（encoding-cache）：不再每次 new + free，避免每次
      // 刷新 meta bar 都重建一整张 BPE ranks 表。代价是取到的表是共享句柄，
      // 因此这里（以及任何持有方）都不能再 `free()`。
      const encoding = getNodeEncodingForModel(tiktokenModel);
      if (encoding == null) {
        // 模型名不被 tiktoken 认识（编码表建不起来）→ 仍走真分词器近似，
        // 只是降级到默认 cl100k，而不是退回字符折算。
        tokenCount = fallbackCount(serialized);
        counterKind = "heuristic";
        estimated = true;
        return pack(savedModelId, vendorModelId, family, tokenCount, counterKind, estimated);
      }
      tokenCount = countOpenAiStyleMessages(
        encoding,
        [wrapSerializedPromptAsSystemMessage(serialized)],
        tiktokenModel,
      );
      // 精确档：真 tiktoken 家族读数，counterKind 如实报 `tiktoken`。
      counterKind = "tiktoken";
    } else if (WEB_FAMILIES.has(family)) {
      const web = await countWebFamilyPrompt(family, serialized);
      tokenCount = web.count;
      // 资产加载失败时 estimated=true 且读数已退到 cl100k 近似——此时 counterKind
      // 必须跟着降级为 heuristic，否则家族名冒充精确读数，压缩阈值会跳过 0.85
      // 安全系数（fallback-caliber-align C 线：修 WEB/SP 失败分支谎报）。
      counterKind = web.estimated ? "heuristic" : family;
      estimated = web.estimated;
    } else if (SP_FAMILIES.has(family)) {
      const sp = await countSentencePieceFamilyPrompt(family, serialized);
      tokenCount = sp.count;
      // SP 家族同理：加载失败 → cl100k 近似 + heuristic，不冒充家族级精确读数。
      counterKind = sp.estimated ? "heuristic" : family;
      estimated = sp.estimated;
    } else {
      // 未来新增的家族尚未接上真 tokenizer：走默认 cl100k 近似而非字符折算。
      tokenCount = fallbackCount(serialized);
      counterKind = "heuristic";
      estimated = true;
    }
  } catch {
    tokenCount = fallbackCount(serialized);
    counterKind = "heuristic";
    estimated = true;
  }

  return pack(
    savedModelId,
    vendorModelId,
    family,
    tokenCount,
    counterKind,
    estimated,
  );
}

function pack(
  savedModelId: string,
  vendorModelId: string,
  tokenizerFamily: TokenizerFamily,
  tokenCount: number,
  counterKind: TokenCounterKind,
  estimated: boolean,
): PromptTokenCountResult {
  return {
    tokenCount,
    counterKind,
    estimated,
    savedModelId,
    vendorModelId,
    tokenizerFamily,
  };
}
