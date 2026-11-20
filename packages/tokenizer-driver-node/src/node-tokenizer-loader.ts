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

export namespace NodeTokenizerLoader {
  /** Default assets root: `packages/tokenizer-driver-node/assets/tokenizers`. */
  export function defaultAssetsRoot(): string {
    return join(moduleDir, "../assets/tokenizers");
  }

  export function create(assetsRoot: string): TokenizerLoader {
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

  const loaderSlot = { current: undefined as TokenizerLoader | undefined };

  /** Installs the loader used by web/sentencepiece counters in this package. */
  export function set(loader: TokenizerLoader): void {
    loaderSlot.current = loader;
  }

  /** Returns the active loader set by {@link TokenizerNodeRegister.register}. */
  export function get(): TokenizerLoader {
    if (loaderSlot.current == null) {
      // nm-throw: keep — 驱动装配不变量：未注册 loader 即调用属编程错误。
      throw new Error("Node tokenizer loader not installed. Call TokenizerNodeRegister.register() first.");
    }
    return loaderSlot.current;
  }
}
