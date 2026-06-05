/**
 * Types and helpers for Android {@code NovelMasterTokenizer} native module (M1).
 */
import { NativeModules, Platform } from "react-native";

export type NativeCountRequest = {
  serialized: string;
  family: string;
  vendorModelId: string;
};

export type NativeCountResponse = {
  tokenCount: number;
  counterKind: string;
  estimated: boolean;
};

type NovelMasterTokenizerNative = {
  countPrompt: (
    serialized: string,
    family: string,
    vendorModelId: string,
  ) => Promise<NativeCountResponse>;
};

const nativeModule = NativeModules.NovelMasterTokenizer as
  | NovelMasterTokenizerNative
  | undefined;

/** True when the Android native tokenizer module is linked. */
export function isNativeTokenizerAvailable(): boolean {
  return (
    Platform.OS === "android" &&
    typeof nativeModule?.countPrompt === "function"
  );
}

/**
 * Count tokens via Kotlin bridge. Returns null when native is unavailable (iOS / tests).
 */
export async function countPromptViaNative(
  request: NativeCountRequest,
): Promise<NativeCountResponse | null> {
  if (!isNativeTokenizerAvailable() || nativeModule == null) {
    return null;
  }
  try {
    return await nativeModule.countPrompt(
      request.serialized,
      request.family,
      request.vendorModelId,
    );
  } catch {
    return null;
  }
}
