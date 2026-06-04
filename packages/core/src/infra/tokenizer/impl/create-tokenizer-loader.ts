/**
 * Loads vendored tokenizer assets for Node and React Native.
 *
 * @module infra/tokenizer/impl/create-tokenizer-loader
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TokenizerFamily } from "../ports/token-counter.port.js";

export type TokenizerRuntime = "node" | "react-native";

/** Set by Mobile `polyfills` before any tokenizer use (Hermes has no `node:fs`). */
export const NM_TOKENIZER_LOADER_KEY = "__NM_TOKENIZER_LOADER__";

export interface TokenizerLoader {
  readJson(relativePath: string): ArrayBuffer;
  readModel(relativePath: string): string;
}

function injectedLoader(): TokenizerLoader | undefined {
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

/** Active loader: RN injection when present, otherwise Node filesystem. */
export function getTokenizerLoader(): TokenizerLoader {
  return injectedLoader() ?? createNodeTokenizerLoader();
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Core package root (`packages/core`) from compiled `dist/infra/tokenizer/impl`. */
function corePackageRoot(): string {
  return join(moduleDir, "../../../../");
}

function assetsRoot(): string {
  return join(corePackageRoot(), "assets/tokenizers");
}

function createNodeTokenizerLoader(): TokenizerLoader {
  const root = assetsRoot();
  return {
    readJson(relativePath: string): ArrayBuffer {
      const buf = readFileSync(join(root, relativePath));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    readModel(relativePath: string): string {
      return join(root, relativePath);
    },
  };
}

/** Node loader — reads from `packages/core/assets/tokenizers`. */
export function createTokenizerLoader(runtime: "node"): TokenizerLoader;
/** RN loader — requires {@link NM_TOKENIZER_LOADER_KEY} injection (see Mobile polyfills). */
export function createTokenizerLoader(runtime: "react-native"): TokenizerLoader;
export function createTokenizerLoader(runtime: TokenizerRuntime): TokenizerLoader {
  if (runtime === "react-native") {
    const injected = injectedLoader();
    if (injected == null) {
      throw new Error(
        "React Native tokenizer loader not installed; set globalThis.__NM_TOKENIZER_LOADER__ in polyfills",
      );
    }
    return injected;
  }
  return createNodeTokenizerLoader();
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
