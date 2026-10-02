/**
 * One-shot generator for JVM parity goldens (M1-I1; token-count-perf-r2 修 API 漂移).
 * Uses tokenizer-driver-node + package tokenizer assets.
 *
 *   node packages/tokenizer-driver-rn/scripts/generate-tokenizer-parity-goldens.mjs
 *
 * 前置：core 与 tokenizer-driver-node 的 dist 必须是新的（本脚本 import dist）。
 *
 * 字段口径（2026-10-03 起）：
 * - `cliTokenCount`：node 驱动 `countPromptLlmInput` 的完整读数（WEB/SP 家族 =
 *   ST 包装口径，Kotlin 同款包装，容差 max(3, 1%)；tiktoken 家族 = overhead +
 *   分块和，与 Kotlin 直编码**不同口径**，仅作参考不参与断言）。
 * - `rawTextTokenCount`：js-tiktoken/WASM 对**序列化串的裸 encode**（无包装无
 *   overhead）——与 Kotlin gpt 分支（直编码整串）同口径，gpt case 的对拍断言
 *   用这个字段，容差 max(3, ceil(0.5%))。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "../../..");

function distUrl(packageName, ...segments) {
  return pathToFileURL(join(repoRoot, "packages", packageName, "dist", ...segments)).href;
}

const FIXTURE_USER_TEXT = [
  "你好，这是一段用于分词器对拍的中文正文。它包含标点、数字 12345、",
  "英文 mixed words、路径 /a/b/c.md、代码 const x = 1; 以及换行。\n",
  "第二段稍微长一点，用来把 token 数推到百级以上，让 0.5% 的相对容差有牙齿：",
  "The quick brown fox jumps over the lazy dog. 包装误差与转换误差在这种规模下才可分辨。",
  "无空白长中文串病态样本：一二三四五六七八九十百千万亿兆京垓秭穰沟涧正载极恒河沙阿僧祇那由他不可思议无量大数。",
].join("");

function fixtureLayout() {
  return {
    system: "You are helpful.",
    persist: [],
    dynamic: [],
    skillsEnabled: false,
  };
}

function fixtureCtx() {
  return {
    workplaceDisplay: "",
    now: new Date(0),
    messages: [
      {
        id: "1",
        sessionId: "s",
        seq: 1,
        role: "user",
        content: { blocks: [{ type: "text", text: FIXTURE_USER_TEXT }] },
        hidden: false,
        createdAtMs: 0,
      },
    ],
  };
}

async function main() {
  const { registerTokenizerNodeDriver, countPromptLlmInput, getNodeEncodingForModel } =
    await import(distUrl("tokenizer-driver-node", "index.js"));
  const { serializePromptLlmInput } = await import(
    distUrl("core", "infra/tokenizer/logic/serialize-prompt-input.js")
  );
  const { createDefaultTokenCounterRegistry } = await import(
    distUrl("core", "infra/tokenizer/index.js")
  );

  registerTokenizerNodeDriver();
  const registry = createDefaultTokenCounterRegistry({
    getTokenizerOverride: async () => "auto",
  });

  const layout = fixtureLayout();
  const ctx = fixtureCtx();
  const serialized = await serializePromptLlmInput(layout, ctx);

  const cases = [
    {
      id: "claude-openai-sonnet",
      family: "claude",
      savedModelId: "openai/claude-3-5-sonnet",
      vendorModelId: "claude-3-5-sonnet",
    },
    {
      id: "gemma-gemini-flash",
      family: "gemma",
      savedModelId: "google/gemini-2.0-flash",
      vendorModelId: "gemini-2.0-flash",
    },
    // gpt 两表（token-count-perf-r2）：Kotlin 直编码 vs js-tiktoken 裸 encode，
    // 对拍字段 rawTextTokenCount。
    {
      id: "gpt-cl100k",
      family: "tiktoken",
      encodingName: "cl100k_base",
      savedModelId: "openai/gpt-4",
      vendorModelId: "gpt-4",
    },
    {
      id: "gpt-o200k",
      family: "tiktoken",
      encodingName: "o200k_base",
      savedModelId: "openai/gpt-4o",
      vendorModelId: "gpt-4o",
    },
  ];

  const outCases = [];
  for (const c of cases) {
    const result = await countPromptLlmInput({
      layout,
      ctx,
      savedModelId: c.savedModelId,
      registry,
    });
    const out = {
      ...c,
      serialized,
      cliTokenCount: result.tokenCount,
      cliEstimated: result.estimated,
      cliCounterKind: result.counterKind,
    };
    if (c.family === "tiktoken") {
      const encoding = getNodeEncodingForModel(c.vendorModelId);
      if (encoding == null) {
        throw new Error(`node 编码表解析失败: ${c.vendorModelId}`);
      }
      out.rawTextTokenCount = encoding.encode(serialized).length;
    }
    outCases.push(out);
    console.log(
      c.id,
      "cli=" + result.tokenCount,
      result.estimated,
      result.counterKind,
      out.rawTextTokenCount != null ? "raw=" + out.rawTextTokenCount : "",
    );
  }

  const outPath = join(
    scriptDir,
    "../android/src/test/resources/tokenizer-parity-goldens.json",
  );
  writeFileSync(
    outPath,
    `${JSON.stringify({ version: 2, cases: outCases }, null, 2)}\n`,
    "utf8",
  );
  console.log("wrote", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
