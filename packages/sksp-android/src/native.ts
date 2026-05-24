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

/** Returns the native SKSP module or throws when unavailable. */
export function getSkspNativeModule(): SkspNativeModule {
  if (!native.SkspModule) {
    throw new Error("SkspModule is not linked (Android only)");
  }
  return native.SkspModule;
}
