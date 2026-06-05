/**
 * Node filesystem tokenizer loader for NMTP driver assets.
 *
 * @module node-tokenizer-loader
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface TokenizerLoader {
  readJson(relativePath: string): ArrayBuffer;
  readModel(relativePath: string): string;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Default assets root: `packages/tokenizer-driver-node/assets/tokenizers`. */
export function defaultTokenizerAssetsRoot(): string {
  return join(moduleDir, "../assets/tokenizers");
}

export function createNodeTokenizerLoader(assetsRoot: string): TokenizerLoader {
  return {
    readJson(relativePath: string): ArrayBuffer {
      const buf = readFileSync(join(assetsRoot, relativePath));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    readModel(relativePath: string): string {
      return join(assetsRoot, relativePath);
    },
  };
}

let activeLoader: TokenizerLoader | null = null;

/** Installs the loader used by web/sentencepiece counters in this package. */
export function setNodeTokenizerLoader(loader: TokenizerLoader): void {
  activeLoader = loader;
}

/** Returns the active loader set by {@link registerTokenizerNodeDriver}. */
export function getNodeTokenizerLoader(): TokenizerLoader {
  if (activeLoader == null) {
    throw new Error(
      "Node tokenizer loader not installed. Call registerTokenizerNodeDriver() first.",
    );
  }
  return activeLoader;
}
