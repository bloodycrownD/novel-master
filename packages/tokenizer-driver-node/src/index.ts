/**
 * Node tokenizer driver for NMTP (CLI / Electron / Node tests).
 *
 * @module tokenizer-driver-node
 */

export { countPromptLlmInput } from "./count-prompt-llm-input.js";
export {
  createNodeTokenizerLoader,
  defaultTokenizerAssetsRoot,
  setNodeTokenizerLoader,
  getNodeTokenizerLoader,
  type TokenizerLoader,
} from "./node-tokenizer-loader.js";
export {
  registerTokenizerNodeDriver,
  NODE_DRIVER_NAME,
  type RegisterTokenizerNodeDriverOptions,
} from "./register.js";
export { TiktokenTokenCounter, clearTiktokenEncodingCache } from "./impl/tiktoken-token-counter.js";
// 兜底计数（stream-metrics-native ④）：默认 cl100k 的真分词器计数 + 编码表单例
// 缓存读口。desktop 主进程的「无模型早退」也复用这里，避免 app 侧另建一张表。
export {
  countTextWithDefaultEncoding,
  getDefaultNodeEncoding,
  getNodeEncodingByName,
  getNodeEncodingForModel,
  clearNodeEncodingCacheForTests,
  __setNodeEncodingFactoryForTests,
  DEFAULT_NODE_ENCODING_NAME,
} from "./impl/encoding-cache.js";
export { registerTokenizerNodeDriverForTests } from "./register-for-tests.js";
