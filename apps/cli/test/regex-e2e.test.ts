/**
 * Regex CLI e2e (CRUD + llm/display channels).
 *
 * @module test/regex-e2e
 */

import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readCliState, runNm } from "./helpers.js";

const PROMPT_YAML = `
blocks:
  chat:
    type: chat
`;

async function setupSession(dbPath: string): Promise<{
  projectId: string;
  sessionId: string;
}> {
  const project = runNm(["project", "create", "--name", "Regex", "--db", dbPath]);
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

describe("regex CLI e2e", () => {
  it("regex-group use/current and delete resets pointer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-regex-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["regex-group", "create", "g1", "--db", dbPath]);
      const use = runNm(["regex-group", "use", "g1", "--db", dbPath]);
      assert.equal(use.status, 0, use.stderr);
      const cur = runNm(["regex-group", "current", "--db", dbPath]);
      assert.match(cur.stdout, /g1/);
      const del = runNm(["regex-group", "delete", "g1", "--db", dbPath]);
      assert.equal(del.status, 0, del.stderr);
      const state = await readCliState(dbPath);
      assert.equal(state.currentRegexGroupId, undefined);
      const curAfter = runNm(["regex-group", "current", "--db", dbPath]);
      assert.notEqual(curAfter.status, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("C6: display-only rule masks message list, not prompt render", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-regex-display-"));
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
        "mysecret@email.com",
        "--db",
        dbPath,
      ]);
      runNm(["regex-group", "create", "filter", "--db", dbPath]);
      runNm(["regex-group", "use", "filter", "--db", dbPath]);
      runNm([
        "regex",
        "create",
        "--regexGroup",
        "filter",
        "--regexId",
        "mask",
        "--name",
        "mask",
        "--pattern",
        "secret",
        "--displayReplace",
        "***",
        "--startDepth",
        "0",
        "--endDepth",
        "99",
        "--user",
        "--db",
        dbPath,
      ]);
      const list = runNm(["message", "list", "--session", sessionId, "--db", dbPath]);
      assert.equal(list.status, 0, list.stderr);
      assert.match(list.stdout, /\*\*\*/);
      assert.doesNotMatch(list.stdout, /secret/);
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
      assert.match(render.stdout, /secret/);
      assert.doesNotMatch(render.stdout, /\*\*\*@/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("C5: llm-only rule masks prompt render, not message list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-regex-llm-"));
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
        "mysecret word",
        "--db",
        dbPath,
      ]);
      runNm(["regex-group", "create", "llm-filter", "--db", dbPath]);
      runNm(["regex-group", "use", "llm-filter", "--db", dbPath]);
      runNm([
        "regex",
        "create",
        "--regexGroup",
        "llm-filter",
        "--regexId",
        "r1",
        "--name",
        "r1",
        "--pattern",
        "secret",
        "--llmReplace",
        "[redacted]",
        "--startDepth",
        "0",
        "--endDepth",
        "99",
        "--user",
        "--db",
        dbPath,
      ]);
      const list = runNm(["message", "list", "--session", sessionId, "--db", dbPath]);
      assert.equal(list.status, 0, list.stderr);
      assert.match(list.stdout, /secret/);
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
      assert.match(render.stdout, /\[redacted\]/);
      assert.doesNotMatch(render.stdout, /mysecret/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("regex test requires --channel", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-regex-test-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["regex-group", "create", "g", "--db", dbPath]);
      runNm([
        "regex",
        "create",
        "--regexGroup",
        "g",
        "--regexId",
        "r",
        "--name",
        "n",
        "--pattern",
        "a",
        "--llmReplace",
        "A",
        "--startDepth",
        "0",
        "--endDepth",
        "2",
        "--user",
        "--db",
        dbPath,
      ]);
      const bad = runNm([
        "regex",
        "test",
        "--regexGroup",
        "g",
        "--regexId",
        "r",
        "--text",
        "a",
        "--db",
        dbPath,
      ]);
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /channel/i);
      const ok = runNm([
        "regex",
        "test",
        "--regexGroup",
        "g",
        "--regexId",
        "r",
        "--channel",
        "llm",
        "--text",
        "a",
        "--db",
        dbPath,
      ]);
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(ok.stdout.trim(), "A");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
