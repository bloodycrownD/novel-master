/**
 * RN 侧 js-tiktoken 编码表的**单例缓存**（stream-metrics-native ④）。
 *
 * 为什么要沉到驱动层（而不是留在 app 的 `stream-token-estimator` 里）：
 * - 编码表构造很贵。`new Tiktoken(ranks)` 实测每次 **185–248ms**（要解析整份
 *   ranks 表），而 **js-tiktoken 自身没有任何缓存**——同一进程里建两份表就是
 *   白付两次 200ms+ 的主线程卡顿，还双份吃内存。
 * - 驱动方向是「app 依赖驱动」。反过来让驱动 import app 的私有缓存既违反依赖
 *   方向，tsc 上也不通（`tsconfig.base.json` 无 paths、驱动 `rootDir: ./src`），
 *   所以正确的落点只能在驱动里、app 侧改为 import 本模块。
 * - 本模块**不引入任何 RN 运行时依赖**（只依赖 `js-tiktoken` 与 core 的纯
 *   计数 helper），因此可以被 app 的纯逻辑服务直接引用而不必拖进
 *   `react-native` / 原生 bridge。
 *
 * 缓存策略照搬 app 侧既有口径，不重新发明：
 * - 惰性构造：不在模块顶层建表（RN 依赖 `fast-text-encoding` polyfill 先执行，
 *   顶层构造有环境未就绪风险）；
 * - 按编码名单例（cl100k / o200k 各一份）；
 * - **构造失败缓存 null 且不再重试**——同一进程内反复重试同一条必然失败的构造
 *   只是白烧 CPU（缺 ranks / 环境未就绪都不会在运行期自愈），代价是该进程后续
 *   一律走降级路径。这是可接受的降级，不是 bug。
 *
 * @module tokenizer-driver-rn/impl/encoding-cache
 */
import { countTextWithIncrementalTokenizer } from "@novel-master/core/provider";
import { Tiktoken } from "js-tiktoken/lite";
import * as cl100kRanksModule from "js-tiktoken/ranks/cl100k_base";
import * as o200kRanksModule from "js-tiktoken/ranks/o200k_base";

/** 本驱动支持的编码名。 */
export type RnEncodingName = "cl100k_base" | "o200k_base";

/**
 * 编码器窄口：只要「文本 → token 数」，不暴露具体实现（便于换表 / 换实现）。
 */
export interface RnTokenEncoding {
  encode(text: string): ArrayLike<unknown>;
}

/**
 * 默认编码名：拿不到模型信息时的兜底表。
 *
 * 非 tiktoken 家族（claude / qwen / glm / gemma…）也用它——这些模型各有自己的
 * tokenizer，js-tiktoken 给不出真值，但**任何真分词器都比字符折算强**
 * （折算对中文低估 82%~84%），近似估算在这里是净收益。
 */
export const DEFAULT_RN_ENCODING_NAME: RnEncodingName = "cl100k_base";

/** 编码表按编码名缓存；null = 构造失败（不再重试，见模块头注释）。 */
const encodingByName = new Map<RnEncodingName, RnTokenEncoding | null>();

/**
 * 构造器覆盖钩子（仅测试用）：`null` = 走默认 `new Tiktoken(ranks)`。
 * 设成抛错的函数即可在真机上复现「编码表建不起来」这条降级路径。
 */
let encodingFactory:
  | ((name: RnEncodingName) => RnTokenEncoding)
  | null = null;

/**
 * ranks 命名空间取默认导出兼容形态。
 *
 * ranks 模块 ESM 侧是 default 导出、CJS 侧是命名导出；Metro / jest(ESM) /
 * jest(CJS) / Vite 四种环境下形态不同，统一经 `(mod.default ?? mod)` 取值。
 */
function unwrapRanksModule(mod: unknown): unknown {
  const candidate = mod as { default?: unknown } | null | undefined;
  return candidate?.default ?? mod;
}

/** 取（或惰性构造）指定编码的编码表；构造失败返回 null 并缓存该失败。 */
export function getRnEncoding(name: RnEncodingName): RnTokenEncoding | null {
  const cached = encodingByName.get(name);
  if (cached !== undefined) {
    return cached;
  }
  let encoding: RnTokenEncoding | null = null;
  try {
    encoding = encodingFactory
      ? encodingFactory(name)
      : (new Tiktoken(
          (name === "o200k_base"
            ? unwrapRanksModule(o200kRanksModule)
            : unwrapRanksModule(cl100kRanksModule)) as never,
        ) as unknown as RnTokenEncoding);
  } catch (err) {
    console.warn(
      "[novel-master/tokenizer-driver-rn] js-tiktoken encoding init failed",
      err,
    );
    encoding = null;
  }
  encodingByName.set(name, encoding);
  return encoding;
}

/** 默认（cl100k）编码表取用口。 */
export function getDefaultRnEncoding(): RnTokenEncoding | null {
  return getRnEncoding(DEFAULT_RN_ENCODING_NAME);
}

/**
 * 用默认编码表（cl100k）计一段文本的 token 数。
 *
 * 走 core 的 `countTextWithIncrementalTokenizer` 而不是直接 `encode`：后者对
 * 「无空白长中文串」是 O(len²)（实测 12K 字符 93s），前者把单次 encode 夹在
 * ≤64 字符、同一段文本耗时与全量 encode 打平（30K 中文 273ms vs 266ms），
 * 病态档还快 189 倍。
 *
 * @param text 待计数文本。
 * @returns token 数；**编码表不可用时返回 null**，调用方须自行决定降级口径
 *   （不要把 null 当 0）。
 */
export function countTextWithDefaultEncoding(text: string): number | null {
  const encoding = getDefaultRnEncoding();
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
 * 刻意与 {@link __setRnEncodingFactoryForTests} 分开：后者已经会顺带作废缓存，
 * 若这里再顺手把构造器也还原，「先注入故障构造器、再清缓存」这种最自然的
 * 测试写法就会被悄悄 undo，故两个钩子各管一件事。
 */
export function __resetRnEncodingCacheForTests(): void {
  encodingByName.clear();
}

/** 测试钩子：覆盖编码表构造器（传 `null` 还原默认实现）。 */
export function __setRnEncodingFactoryForTests(
  factory: ((name: RnEncodingName) => RnTokenEncoding) | null,
): void {
  encodingFactory = factory;
  // 构造器换了，已缓存的表不再由它产出，必须一并作废。
  encodingByName.clear();
}
