/**
 * 将完整 Prompt LLM 输入序列化为 token 计数字符串（token 计数 parity）。
 *
 * 本名是序列化入口的跨包契约名（driver / 三端 token 面共用），
 * 以别名转发 {@link formatPromptLlmInputForCliFromLayout}（错误通道迁移
 * 四期已 Result 化，本文件不再包一层 async 解包装）。
 *
 * @module infra/tokenizer/logic/serialize-prompt-input
 */

export { formatPromptLlmInputForCliFromLayout as serializePromptLlmInput } from "@/service/prompt/render-prompt.js";
