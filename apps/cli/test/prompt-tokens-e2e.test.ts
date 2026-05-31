/**
 * `prompt render --tokens` CLI e2e (stderr JSON, stdout render text).
 *
 * @module test/prompt-tokens-e2e
 */

import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runNm } from "./helpers.js";

const PROMPT_YAML = `
blocks:
  chat:
    type: chat
`;

async function setupSession(dbPath: string): Promise<{
  projectId: string;
  sessionId: string;
}> {
  const project = runNm(["project", "create", "--name", "Prompt", "--db", dbPath]);
  assert.equal(project.status, 0, project.stderr);
  const projectId = project.stdout.trim();
  const session = runNm([
    "session",
    "create",
    "--project",
    projectId,
    "--db",
    dbPath,
  ]);
  assert.equal(session.status, 0, session.stderr);
  return { projectId, sessionId: session.stdout.trim() };
}

function parseTokenJsonLine(stderr: string): {
  tokenCount: number;
  counter?: string;
  counterKind?: string;
} {
  const line = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith("{") && l.includes("tokenCount"));
  assert.ok(line, `expected token JSON line in stderr: ${stderr}`);
  return JSON.parse(line) as {
    tokenCount: number;
    counter?: string;
    counterKind?: string;
  };
}

describe("prompt render --tokens CLI e2e", () => {
  it("CLI1: --tokens writes stderr JSON with tokenCount > 0 and stdout render text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-prompt-tokens-"));
    const dbPath = join(dir, "novel.db");
    const promptPath = join(dir, "prompt.yaml");
    try {
      await writeFile(promptPath, PROMPT_YAML, "utf8");
      const { projectId, sessionId } = await setupSession(dbPath);
      runNm([
        "message",
        "append",
        "--session",
        sessionId,
        "--role",
        "user",
        "--content",
        "hello tokens",
        "--db",
        dbPath,
      ]);

      const render = runNm([
        "prompt",
        "render",
        "--path",
        promptPath,
        "--tokens",
        "--project",
        projectId,
        "--session",
        sessionId,
        "--db",
        dbPath,
      ]);
      assert.equal(render.status, 0, render.stderr);
      assert.match(render.stdout, /hello tokens/);

      const tokens = parseTokenJsonLine(render.stderr);
      assert.ok(tokens.tokenCount > 0);
      assert.equal(tokens.counter ?? tokens.counterKind, "heuristic");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("CLI2: without --tokens stderr has no token JSON line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-prompt-no-tokens-"));
    const dbPath = join(dir, "novel.db");
    const promptPath = join(dir, "prompt.yaml");
    try {
      await writeFile(promptPath, PROMPT_YAML, "utf8");
      const { projectId, sessionId } = await setupSession(dbPath);
      runNm([
        "message",
        "append",
        "--session",
        sessionId,
        "--role",
        "user",
        "--content",
        "plain render",
        "--db",
        dbPath,
      ]);

      const render = runNm([
        "prompt",
        "render",
        "--path",
        promptPath,
        "--project",
        projectId,
        "--session",
        sessionId,
        "--db",
        dbPath,
      ]);
      assert.equal(render.status, 0, render.stderr);
      assert.match(render.stdout, /plain render/);
      assert.doesNotMatch(render.stderr, /"tokenCount"\s*:/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
