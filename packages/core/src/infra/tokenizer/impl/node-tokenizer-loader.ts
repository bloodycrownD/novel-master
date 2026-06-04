/**
 * Node-only tokenizer asset loader (`node:fs`). Not bundled for React Native.
 *
 * @module infra/tokenizer/impl/node-tokenizer-loader
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TokenizerLoader } from "./tokenizer-loader-shared.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function corePackageRoot(): string {
  return join(moduleDir, "../../../../");
}

function assetsRoot(): string {
  return join(corePackageRoot(), "assets/tokenizers");
}

/** Reads vendored assets from `packages/core/assets/tokenizers`. */
export function createNodeTokenizerLoader(): TokenizerLoader {
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
