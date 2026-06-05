/**
 * Tokenizer asset path table — platform-agnostic relative paths per family.
 *
 * @module infra/tokenizer/logic/tokenizer-asset-paths
 */

import type { TokenizerFamily } from "../ports/token-counter.port.js";

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
      return { primary: "web/qwen2.json", fallback: "llama3.json", kind: "json" };
    case "command-r":
      return { primary: "web/command-r.json", fallback: "llama3.json", kind: "json" };
    case "command-a":
      return { primary: "web/command-a.json", fallback: "llama3.json", kind: "json" };
    case "nemo":
      return { primary: "web/nemo.json", fallback: "llama3.json", kind: "json" };
    case "deepseek":
      return { primary: "web/deepseek.json", fallback: "llama3.json", kind: "json" };
    default:
      return null;
  }
}
