/**
 * RN / Metro entry: register NMTP driver (mirrors {@link @novel-master/tdbc-driver-rn}/native).
 *
 * @module tokenizer-driver-rn/native
 */

export { TokenizerRnRegister } from "./register.js";
export {
  AndroidNativeBridge,
  type NativeCountRequest,
  type NativeCountResponse,
} from "./android-native-bridge.js";
