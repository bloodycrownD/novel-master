/**
 * One-shot generator for JVM parity goldens (M1-I1).
 * Uses core countPromptLlmInputNode + CLI tokenizer assets.
 *
 *   node apps/mobile/android/scripts/generate-tokenizer-parity-goldens.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "../../../..");
const cliAssets = join(repoRoot, "apps/cli/assets/tokenizers");

function distUrl(...segments) {
  return pathToFileURL(join(repoRoot, "packages/core/dist", ...segments)).href;
}

async function installCliTokenizerLoader() {
  const { NM_TOKENIZER_LOADER_KEY } = await import(distUrl("infra/tokenizer/index.js"));
  const loader = {
    readJson(relativePath) {
      const buf = readFileSync(join(cliAssets, relativePath));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    readModel(relativePath) {
      return join(cliAssets, relativePath);
    },
  };
  globalThis[NM_TOKENIZER_LOADER_KEY] = loader;
}

function fixtureInput() {
  return {
    system: "You are helpful.",
    messages: [
      {
        id: "1",
        sessionId: "s",
        seq: 1,
        role: "user",
        content: { blocks: [{ type: "text", text: "Hello" }] },
        hidden: false,
        createdAtMs: 0,
      },
    ],
  };
}

async function main() {
  const { serializePromptLlmInput } = await import(
    distUrl("infra/tokenizer/logic/serialize-prompt-input.js"),
  );
  const { countPromptLlmInputNode } = await import(
    distUrl("infra/tokenizer/logic/count-prompt-llm-input-node.js"),
  );
  const { createDefaultTokenCounterRegistry } = await import(distUrl("infra/tokenizer/index.js"));

  await installCliTokenizerLoader();
  const registry = createDefaultTokenCounterRegistry({
    getTokenizerOverride: async () => "auto",
  });

  const input = fixtureInput();
  const serialized = serializePromptLlmInput(input);

  const cases = [
    {
      id: "claude-openai-sonnet",
      family: "claude",
      applicationModelId: "openai/claude-3-5-sonnet",
      vendorModelId: "claude-3-5-sonnet",
    },
    {
      id: "gemma-gemini-flash",
      family: "gemma",
      applicationModelId: "google/gemini-2.0-flash",
      vendorModelId: "gemini-2.0-flash",
    },
  ];

  const outCases = [];
  for (const c of cases) {
    const result = await countPromptLlmInputNode({
      input,
      applicationModelId: c.applicationModelId,
      registry,
    });
    outCases.push({
      ...c,
      serialized,
      cliTokenCount: result.tokenCount,
      cliEstimated: result.estimated,
      cliCounterKind: result.counterKind,
    });
    console.log(c.id, result.tokenCount, result.estimated, result.counterKind);
  }

  const outPath = join(
    scriptDir,
    "../app/src/test/resources/tokenizer-parity-goldens.json",
  );
  writeFileSync(
    outPath,
    `${JSON.stringify({ version: 1, cases: outCases }, null, 2)}\n`,
    "utf8",
  );
  console.log("wrote", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
