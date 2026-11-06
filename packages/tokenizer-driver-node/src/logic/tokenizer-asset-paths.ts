/**
 * node 侧的 tokenizer 资产路径表（相对 `assets/tokenizers/`）。
 *
 * 本表只描述 node/desktop/CLI 平台的资产布局；Android 侧有自己的
 * `TokenizerAssetPaths.kt`，两者有意不同——Node 有 SentencePiece WASM 能跑
 * `.model`，Android 无 SP native 只能走转换后的 `.json`。
 *
 * Tokenizer asset path table — node-platform relative paths per family.
 *
 * @module tokenizer-driver-node/logic/tokenizer-asset-paths
 */

import type { TokenizerFamily } from "@novel-master/core/provider";

/** Relative asset paths per tokenizer family (ST parity). */
export function tokenizerAssetPaths(family: TokenizerFamily): {
  readonly primary: string;
  readonly fallback?: string;
  readonly kind: "json" | "model";
} | null {
  switch (family) {
    case "claude":
      return { primary: "claude.json", kind: "json" };
    case "llama3":
      return { primary: "llama3.json", kind: "json" };
    case "llama":
      return { primary: "llama.model", kind: "model" };
    case "mistral":
      return { primary: "mistral.model", kind: "model" };
    case "yi":
      return { primary: "yi.model", kind: "model" };
    case "gemma":
      return { primary: "gemma.model", kind: "model" };
    case "jamba":
      return { primary: "jamba.model", kind: "model" };
    case "qwen2":
      return {
        primary: "web/qwen2.json",
        fallback: "llama3.json",
        kind: "json",
      };
    case "command-r":
      return {
        primary: "web/command-r.json",
        fallback: "llama3.json",
        kind: "json",
      };
    case "command-a":
      return {
        primary: "web/command-a.json",
        fallback: "llama3.json",
        kind: "json",
      };
    case "nemo":
      return {
        primary: "web/nemo.json",
        fallback: "llama3.json",
        kind: "json",
      };
    case "deepseek":
      return {
        primary: "web/deepseek.json",
        fallback: "llama3.json",
        kind: "json",
      };
    case "glm":
      return { primary: "web/glm.json", fallback: "llama3.json", kind: "json" };
    default:
      return null;
  }
}
