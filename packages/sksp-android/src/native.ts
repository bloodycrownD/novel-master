/**
 * React Native bridge to Android Keystore SKSP module.
 *
 * @module sksp-android/native
 */

import { NativeModules } from "react-native";

export interface SkspNativeEncryptResult {
  readonly ciphertext: string;
  readonly iv: string;
}

interface SkspNativeModule {
  encrypt(ref: string, plain: string): Promise<SkspNativeEncryptResult>;
  decrypt(ref: string, ciphertextB64: string, ivB64: string): Promise<string>;
}

const native = NativeModules as { SkspModule?: SkspNativeModule };

// nm-style 注记：文件名 native 太泛，按内容主体起名（SkspNative）。
/** Returns the native SKSP module or throws when unavailable. */
export namespace SkspNative {
  export function get(): SkspNativeModule {
    if (!native.SkspModule) {
      // nm-throw: keep — native bridge 边界：SkspModule 未链接（Android 原生侧装配缺失）。
      throw new Error("SkspModule is not linked (Android only)");
    }
    return native.SkspModule;
  }
}
