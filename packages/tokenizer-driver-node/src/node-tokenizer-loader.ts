/**
 * Node filesystem tokenizer loader for NMTP driver assets.
 *
 * @module node-tokenizer-loader
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assert } from "@novel-master/core/common";

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
        // 编程护栏（assert 通道）：未注册 loader 即调用属 API 误用（register 缺参同款）。
        assert(loaderSlot.current != null, "Node tokenizer loader not installed. Call TokenizerNodeRegister.register() first.");
        return loaderSlot.current;
    }
}
