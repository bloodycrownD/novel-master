/**
 * Test-only Node tokenizer loader install (reads `apps/mobile/assets/tokenizers`).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NM_TOKENIZER_LOADER_KEY, type TokenizerLoader } from "../../../src/infra/tokenizer/index.js";

function assetsRoot(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../apps/mobile/assets/tokenizers",
  );
}

export function installNodeTestTokenizerLoader(): void {
  const root = assetsRoot();
  const loader: TokenizerLoader = {
    readJson(relativePath: string): ArrayBuffer {
      const buf = readFileSync(join(root, relativePath));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    readModel(relativePath: string): string {
      return join(root, relativePath);
    },
  };
  (globalThis as Record<string, unknown>)[NM_TOKENIZER_LOADER_KEY] = loader;
}
