/**
 * React Native tokenizer driver for NMTP (Hermes + Android native bridge).
 *
 * @module tokenizer-driver-rn
 */

export { countPromptLlmInputRn, __test__ } from "./count-prompt-llm-input.js";
export {
  countPromptViaNative,
  cancelSessionNativeCounts,
  isNativeTokenizerAvailable,
  countPromptCancelableAvailable,
  cancelCountAvailable,
  PromptCountCancelledError,
  type NativeCountRequest,
  type NativeCountResponse,
} from "./android-native-bridge.js";
export { registerTokenizerRnDriver, RN_DRIVER_NAME } from "./register.js";
export {
  getRnEncoding,
  getDefaultRnEncoding,
  countTextWithDefaultEncoding,
  DEFAULT_RN_ENCODING_NAME,
  type RnEncodingName,
  type RnTokenEncoding,
} from "./impl/encoding-cache.js";
export {
  __resetRnEncodingCacheForTests,
  __setRnEncodingFactoryForTests,
} from "./impl/encoding-cache.js";
