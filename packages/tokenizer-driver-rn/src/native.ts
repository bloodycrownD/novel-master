/**
 * RN / Metro entry: register NMTP driver (mirrors {@link @novel-master/tdbc-driver-rn}/native).
 *
 * @module tokenizer-driver-rn/native
 */

export { registerTokenizerRnDriver, RN_DRIVER_NAME } from "./register.js";
export {
  countPromptViaNative,
  isNativeTokenizerAvailable,
  type NativeCountRequest,
  type NativeCountResponse,
} from "./android-native-bridge.js";
