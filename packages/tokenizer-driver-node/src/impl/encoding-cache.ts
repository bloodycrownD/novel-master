/**
 * Node 侧 tiktoken 编码表的**模块级单例缓存**（stream-metrics-native ④）。
 *
 * 为什么必须有这张表：兜底计数从 `ceil(字符数 / 3.35)` 换成真分词器后，每次
 * 兜底都要拿到一张编码表。而 `tiktoken`（WASM）的 `encoding_for_model` /
 * `get_encoding` **每次调用都新建一整张 BPE 表**，`free()` 才释放——原实现在
 * `count-prompt-llm-input.ts` 里就是「用完立刻 `free()`」，等价于每次计数都重建
 * 一张几十 MB 的 ranks 表再扔掉。在「每次刷新 meta bar 都要重算」的路径上，这是
 * 白付的 CPU + GC。
 *
 * 为什么 `free()` 在缓存之后就不再调用：`Tiktoken` 是 WASM 侧对象，`free()` 会
 * 把底层表从 WASM 堆里释放掉。缓存意味着**多个调用方共享同一张表**（精确档
 * `countPromptLlmInput` 与兜底档都从这里拿），任何一方提前 `free()` 都会让其它
 * 持有者拿到已释放的句柄、后续 `encode` 直接炸。所以本模块把「构造一次、
 * 进程内一直活着」作为不变量：{@link clearNodeEncodingCacheForTests} 也只丢弃
 * 引用、不 `free()`，WASM 内存随进程退出整体回收（编码表数量以「模型名 + 编码名」
 * 为界，是有上界的小集合，不存在无界增长）。
 *
 * 失败也缓存（`null`）且**不重试**：构造失败的原因（模型名不被 `tiktoken` 认识、
 * ranks 资源缺失）在运行期不会自愈，同一进程内反复重试只是白烧 CPU。代价是该
 * 进程后续一律走降级路径——这是可接受的降级，不是 bug。
 *
 * 计数一律走 core 的 {@link countTextWithIncrementalTokenizer} 而不是直接
 * `encode`：后者对「无空白长中文串」是 O(len²)（实测 12K 字符约 88s），前者把
 * 单次 encode 夹在 ≤64 字符、正常文本上与全量 encode 打平，病态档还快两个数量级。
 *
 * @module tokenizer-driver-node/impl/encoding-cache
 */

import { countTextWithIncrementalTokenizer } from "@novel-master/core/provider";
import {
  encoding_for_model,
  get_encoding,
  type Tiktoken,
  type TiktokenEncoding,
  type TiktokenModel,
} from "tiktoken";

/**
 * 默认编码名：拿不到模型信息（或模型名不被 tiktoken 认识）时的兜底表。
 *
 * 非 tiktoken 家族（claude / qwen / glm / gemma…）也用它——这些模型各有自己的
 * tokenizer，tiktoken 给不出真值，但**任何真分词器都比字符折算强**（折算对中文
 * 正文低估 82%~84%），近似估算在这里是净收益。正因为只是近似，调用方必须继续
 * 报 `counterKind: "heuristic"`。
 */
export const DEFAULT_NODE_ENCODING_NAME: TiktokenEncoding = "cl100k_base";

/** 编码表缓存；`null` = 构造失败（不再重试，见模块头注释）。 */
const encodingByKey = new Map<string, Tiktoken | null>();

/**
 * 构造器覆盖钩子（仅测试用）：`null` = 走真实 tiktoken。
 * 设成抛错的函数即可复现「编码表建不起来」这条降级路径。
 */
type EncodingFactory = (key: string) => Tiktoken;
let encodingFactory: EncodingFactory | null = null;

function getCached(key: string, build: () => Tiktoken): Tiktoken | null {
  const cached = encodingByKey.get(key);
  if (cached !== undefined) {
    return cached;
  }
  let encoding: Tiktoken | null = null;
  try {
    encoding = encodingFactory ? encodingFactory(key) : build();
  } catch (err) {
    console.warn(
      `[novel-master/tokenizer-driver-node] tiktoken encoding init failed (${key})`,
      err,
    );
    encoding = null;
  }
  encodingByKey.set(key, encoding);
  return encoding;
}

/**
 * 按**模型名**取（单例）编码表；模型名不被 tiktoken 认识时返回 `null`。
 *
 * 精确档（`counterKind: "tiktoken"`）走这里——注意取到的是**共享单例**，调用方
 * 不得 `free()`。
 */
export function getNodeEncodingForModel(
  tiktokenModel: TiktokenModel | string,
): Tiktoken | null {
  return getCached(`model:${tiktokenModel}`, () =>
    encoding_for_model(tiktokenModel as TiktokenModel),
  );
}

/** 按**编码名**取（单例）编码表；失败返回 `null`。 */
export function getNodeEncodingByName(
  name: TiktokenEncoding | string,
): Tiktoken | null {
  return getCached(`enc:${name}`, () => get_encoding(name as TiktokenEncoding));
}

/** 默认（cl100k）编码表取用口。 */
export function getDefaultNodeEncoding(): Tiktoken | null {
  return getNodeEncodingByName(DEFAULT_NODE_ENCODING_NAME);
}

/**
 * 用默认编码表（cl100k）计一段文本的 token 数。
 *
 * @param text 待计数文本。
 * @returns token 数（估算值，误差实测 ≤0.6%）；**编码表不可用时返回 `null`**，
 *   调用方须自行决定降级口径（不要把 `null` 当 0）。
 */
export function countTextWithDefaultEncoding(text: string): number | null {
  const encoding = getDefaultNodeEncoding();
  if (encoding == null) {
    return null;
  }
  return countTextWithIncrementalTokenizer(
    (chunk) => encoding.encode(chunk).length,
    text,
  );
}

/**
 * 测试钩子：只清空编码表单例缓存（不动构造器）。
 *
 * 刻意与 {@link __setNodeEncodingFactoryForTests} 分开：后者已经会顺带作废缓存，
 * 若这里再顺手把构造器也还原，「先注入故障构造器、再清缓存」这种最自然的测试写法
 * 就会被悄悄 undo，故两个钩子各管一件事。
 *
 * 注意这里**不 `free()`**（见模块头「free 生命周期」）。
 */
export function clearNodeEncodingCacheForTests(): void {
  encodingByKey.clear();
}

/** 测试钩子：覆盖编码表构造器（传 `null` 还原真实实现）。 */
export function __setNodeEncodingFactoryForTests(
  factory: EncodingFactory | null,
): void {
  encodingFactory = factory;
  // 构造器换了，已缓存的表不再由它产出，必须一并作废。
  encodingByKey.clear();
}
