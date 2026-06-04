/**
 * Installs Node filesystem tokenizer loader for CLI (core only exposes the port).
 *
 * Assets live under `apps/mobile/assets/tokenizers` (single monorepo copy).
 *
 * @module tokenizer/install-node-tokenizer-loader
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NM_TOKENIZER_LOADER_KEY, type TokenizerLoader } from "@novel-master/core";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function mobileTokenizerAssetsRoot(): string {
  return join(moduleDir, "../../../mobile/assets/tokenizers");
}

function createNodeTokenizerLoader(): TokenizerLoader {
  const root = mobileTokenizerAssetsRoot();
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

/** Call once before any `countPromptLlmInput` on Node. */
export function installNodeTokenizerLoader(): void {
  (globalThis as Record<string, unknown>)[NM_TOKENIZER_LOADER_KEY] =
    createNodeTokenizerLoader();
}

export { installNodePromptTokenCounter } from "./install-node-prompt-token-counter.js";
