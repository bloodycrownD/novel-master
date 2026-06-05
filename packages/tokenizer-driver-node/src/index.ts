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
export { registerTokenizerNodeDriverForTests } from "./register-for-tests.js";
