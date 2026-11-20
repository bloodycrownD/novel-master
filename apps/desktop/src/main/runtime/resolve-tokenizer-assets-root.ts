/**
 * Tokenizer asset root for NMTP Node driver.
 * Packaged apps read from electron-builder extraResources; dev uses monorepo package path.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { defaultTokenizerAssetsRoot } from "@novel-master/tokenizer-driver-node";

const require = createRequire(import.meta.url);

// nm-style 注记：文件名 resolve- 动词前缀，按内容主体起名（TokenizerAssetsRoot）。
export namespace TokenizerAssetsRoot {
  export function resolve(): string {
    if (process.env.NOVEL_MASTER_TOKENIZER_ASSETS) {
      return process.env.NOVEL_MASTER_TOKENIZER_ASSETS;
    }
    try {
      const { app } = require("electron") as typeof import("electron");
      if (app.isPackaged) {
        return path.join(process.resourcesPath, "tokenizers");
      }
    } catch {
      // Node test host — fall through to monorepo default.
    }
    return defaultTokenizerAssetsRoot();
  }
}
