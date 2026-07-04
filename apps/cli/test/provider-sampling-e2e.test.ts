import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runNm, seedMockProviderModels } from "./helpers.js";

const FETCH_CAPTURE_ENV = {
  NM_LLM_E2E_FETCH: "1",
};

function parseE2eRequestBody(stderr: string): Record<string, unknown> {
  const prefix = "NM_LLM_E2E_BODY:";
  const line = stderr.split(/\r?\n/).find((l) => l.includes(prefix));
  assert.ok(line, `expected ${prefix} in stderr`);
  const json = line!.slice(line!.indexOf(prefix) + prefix.length);
  return JSON.parse(json) as Record<string, unknown>;
}

describe("provider model sampling CLI e2e", () => {
  it("E3: sampling set --file merges temperature into model request body", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-sampling-e3-"));
    const dbPath = join(dir, "novel.db");
    const profilePath = join(dir, "profile.json");
    try {
      await writeFile(
        profilePath,
        JSON.stringify({
          schemaVersion: 1,
          enabled: true,
          params: { protocol: "openai", openai: { temperature: 0.42 } },
        }),
        "utf8",
      );
      const models = seedMockProviderModels(dbPath, ["sampling"], FETCH_CAPTURE_ENV);
      const savedModelId = models.get("sampling")!;

      const set = runNm(
        [
          "provider",
          "model",
          "sampling",
          "set",
          "--modelId",
          savedModelId,
          "--file",
          profilePath,
          "--db",
          dbPath,
        ],
        { env: FETCH_CAPTURE_ENV },
      );
      assert.equal(set.status, 0, set.stderr);

      const req = runNm(
        [
          "model",
          "request",
          "--modelId",
          savedModelId,
          "--content",
          "hi",
          "--db",
          dbPath,
        ],
        { env: FETCH_CAPTURE_ENV },
      );
      assert.equal(req.status, 0, req.stderr);
      const body = parseE2eRequestBody(req.stderr);
      assert.equal(body.temperature, 0.42);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("E4: sampling clear omits custom sampling from request body", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-sampling-e4-"));
    const dbPath = join(dir, "novel.db");
    const profilePath = join(dir, "profile.json");
    try {
      await writeFile(
        profilePath,
        JSON.stringify({
          schemaVersion: 1,
          enabled: true,
          params: { protocol: "openai", openai: { temperature: 0.9 } },
        }),
        "utf8",
      );
      const models = seedMockProviderModels(dbPath, ["sampling"], FETCH_CAPTURE_ENV);
      const savedModelId = models.get("sampling")!;
      runNm(
        [
          "provider",
          "model",
          "sampling",
          "set",
          "--modelId",
          savedModelId,
          "--file",
          profilePath,
          "--db",
          dbPath,
        ],
        { env: FETCH_CAPTURE_ENV },
      );
      const clear = runNm(
        [
          "provider",
          "model",
          "sampling",
          "clear",
          "--modelId",
          savedModelId,
          "--db",
          dbPath,
        ],
        { env: FETCH_CAPTURE_ENV },
      );
      assert.equal(clear.status, 0, clear.stderr);

      const req = runNm(
        [
          "model",
          "request",
          "--modelId",
          savedModelId,
          "--content",
          "hi",
          "--db",
          dbPath,
        ],
        { env: FETCH_CAPTURE_ENV },
      );
      assert.equal(req.status, 0, req.stderr);
      const body = parseE2eRequestBody(req.stderr);
      assert.equal(body.temperature, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
