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
      // nm-throw: keep — 平台强制（native bridge 边界）：SkspModule 未链接属 Android 原生侧装配缺失（运行时环境事实，非调用方可控编程错误）；消费方（android-secret-store）在 sksp 协议内以 throw 收口，改签名跨文件跨分片。
      throw new Error("SkspModule is not linked (Android only)");
    }
    return native.SkspModule;
  }
}
