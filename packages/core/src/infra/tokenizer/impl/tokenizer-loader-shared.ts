/**
 * Tokenizer loader types and asset paths — safe for React Native (no Node builtins).
 *
 * @module infra/tokenizer/impl/tokenizer-loader-shared
 */

import type { TokenizerFamily } from "../ports/token-counter.port.js";

/** Set by Mobile `polyfills` or CLI `installNodeTokenizerLoader` before tokenizer use. */
export const NM_TOKENIZER_LOADER_KEY = "__NM_TOKENIZER_LOADER__";

export interface TokenizerLoader {
  readJson(relativePath: string): ArrayBuffer;
  readModel(relativePath: string): string;
}

export function injectedTokenizerLoader(): TokenizerLoader | undefined {
  const g = globalThis as Record<string, unknown>;
  const loader = g[NM_TOKENIZER_LOADER_KEY];
  if (
    loader != null &&
    typeof loader === "object" &&
    typeof (loader as TokenizerLoader).readJson === "function" &&
    typeof (loader as TokenizerLoader).readModel === "function"
  ) {
    return loader as TokenizerLoader;
  }
  return undefined;
}

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
