/**
 * 本模块已下沉 core（fallback-caliber-align D 线）：实现移至
 * `@novel-master/core` 的 `infra/tokenizer/logic/count-openai-style-message`，
 * node 驱动与 RN 侧共用同一份。这里保留原路径做 **namespace + 消息类型** 的
 * re-export——下游 `count-prompt-llm-input.ts` 与 `impl/web-tokenizer-counter.ts`
 * 的 import 路径不动（p24 波 6：平铺函数名已收口进 `OpenAiStyleMessageCount`，
 * 首参窄接口 `TokenEncoder` 与 `CountOpenAiStyleMessageOptions` 属实现细节，
 * 不再转出，调用方按结构传 WASM tiktoken encoding 即可）。
 *
 * 类型差异说明：原首参类型 `import type { Tiktoken } from "tiktoken"` 在下沉版
 * 改为本地窄接口（core 无 tiktoken 运行时依赖）；WASM tiktoken 的
 * `Tiktoken.encode` 返回 `number[]`，结构兼容，调用方无需改动。
 *
 * @module tokenizer-driver-node/logic/count-openai-style-message
 */

export { OpenAiStyleMessageCount } from "@novel-master/core/tokenizer";
export type { OpenAiStyleMessage } from "@novel-master/core/tokenizer";
