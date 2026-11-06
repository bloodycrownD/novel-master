/**
 * node 资产表级守卫：表里写到的每个文件都必须是磁盘上的真文件，且扩展名与 kind 一致。
 *
 * 这张表是 node 平台事实（Android 侧有自己的 TokenizerAssetPaths.kt），
 * 表与磁盘一旦漂移，运行时会静默走兜底——计数从"精确"退成"估算"却不报错。
 * 所以这里遍历全表逐条断言，让漂移在测试期直接红。
 */
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, it } from "node:test";

import type { TokenizerFamily } from "@novel-master/core/provider";

import { tokenizerAssetPaths } from "../src/logic/tokenizer-asset-paths.js";
import { defaultTokenizerAssetsRoot } from "../src/node-tokenizer-loader.js";

/** node 资产表覆盖的家族，与 `tokenizerAssetPaths` 的 switch 分支一一对应。 */
const ASSET_FAMILIES = [
  "claude",
  "llama3",
  "llama",
  "mistral",
  "yi",
  "gemma",
  "jamba",
  "qwen2",
  "command-r",
  "command-a",
  "nemo",
  "deepseek",
  "glm",
] as const satisfies readonly TokenizerFamily[];

const assetsRoot = defaultTokenizerAssetsRoot();

/** `exists()` 会被同名目录骗过，这里必须落到 `isFile()`。 */
function assertAsset(label: string, relative: string, kind: "json" | "model"): void {
  const absolute = join(assetsRoot, relative);
  let isFile = false;
  try {
    isFile = statSync(absolute).isFile();
  } catch {
    isFile = false;
  }
  assert.ok(isFile, `${label} 的资产不存在或不是文件: ${relative}（解析为 ${absolute}）`);
  const expectedExtension = kind === "json" ? ".json" : ".model";
  assert.ok(relative.endsWith(expectedExtension), `${label} 的扩展名与 kind=${kind} 不符: ${relative}`);
}

describe("node 分词资产表级守卫", () => {
  it("资产根解析到 packages/tokenizer-driver-node/assets/tokenizers", () => {
    assert.ok(statSync(assetsRoot).isDirectory(), `资产根不是目录: ${assetsRoot}`);
    assert.equal(basename(assetsRoot), "tokenizers");
    assert.equal(basename(dirname(assetsRoot)), "assets");
  });

  for (const family of ASSET_FAMILIES) {
    it(`${family}: primary/fallback 都是真文件且扩展名与 kind 一致`, () => {
      const spec = tokenizerAssetPaths(family);
      assert.ok(spec != null, `家族 ${family} 在资产表中必须有条目`);
      assertAsset(`家族 ${family}`, spec.primary, spec.kind);
      if (spec.fallback != null) {
        assertAsset(`家族 ${family} 的 fallback`, spec.fallback, spec.kind);
      }
    });
  }

  it("表外家族没有 node 资产条目", () => {
    for (const family of ["heuristic", "tiktoken", "gpt2"] as const) {
      assert.equal(tokenizerAssetPaths(family), null, `${family} 不该有 node 资产条目`);
    }
  });
});
