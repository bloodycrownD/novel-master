/**
 * React Native tokenizer driver for NMTP (Hermes + Android native bridge).
 *
 * @module tokenizer-driver-rn
 */

export { countPromptLlmInputRn, __test__ } from "./count-prompt-llm-input.js";
export {
  countPromptViaNative,
  isNativeTokenizerAvailable,
  type NativeCountRequest,
  type NativeCountResponse,
} from "./android-native-bridge.js";
export { registerTokenizerRnDriver, RN_DRIVER_NAME } from "./register.js";
