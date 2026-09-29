/**
 * 本模块已下沉 core（fallback-caliber-align D 线）：实现移至
 * `@novel-master/core` 的 `infra/tokenizer/logic/count-openai-style-message`，
 * node 驱动与 RN 侧共用同一份。这里保留原路径做**全量 re-export**——下游
 * `count-prompt-llm-input.ts` 与 `impl/web-tokenizer-counter.ts` 的 import
 * 不动；导出面必须覆盖原模块的全部符号（四个函数 + 两个接口），少一个下游
 * 就编译失败。
 *
 * 类型差异说明：原首参类型 `import type { Tiktoken } from "tiktoken"` 在下沉版
 * 改为本地窄接口 `TokenEncoder`（core 无 tiktoken 运行时依赖）；WASM tiktoken
 * 的 `Tiktoken.encode` 返回 `number[]`，结构兼容，调用方无需改动。
 *
 * @module tokenizer-driver-node/logic/count-openai-style-message
 */

export {
  countOpenAiStyleMessages,
  wrapSerializedPromptAsSystemMessage,
  convertMessagesForWebTokenizer,
  countWebTokenizerMessages,
} from "@novel-master/core/provider";
export type {
  OpenAiStyleMessage,
  CountOpenAiStyleMessageOptions,
  TokenEncoder,
} from "@novel-master/core/provider";
