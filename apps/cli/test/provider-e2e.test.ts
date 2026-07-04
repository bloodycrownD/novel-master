/**
 * Provider / model CLI e2e (non-Android, local SQLite).
 *
 * @module test/provider-e2e
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createSavedModelId, readCliState, runNm, savedModelIdByVendor } from "./helpers.js";

describe("provider CLI e2e", () => {
  it("lists five built-in providers on fresh db", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-provider-"));
    const dbPath = join(dir, "novel.db");
    try {
      const list = runNm(["provider", "list", "--db", dbPath]);
      assert.equal(list.status, 0, list.stderr);
      assert.match(list.stdout, /openai/);
      assert.match(list.stdout, /anthropic/);
      assert.match(list.stdout, /google/);
      assert.match(list.stdout, /openrouter/);
      assert.match(list.stdout, /opencode/);
      assert.doesNotMatch(list.stdout, /sk-test/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("edit apiKey masks key in list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-provider-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["provider", "list", "--db", dbPath]);
      const edit = runNm([
        "provider",
        "edit",
        "--providerId",
        "openai",
        "--apiKey",
        "super-secret-key-xyz",
        "--db",
        dbPath,
      ]);
      assert.equal(edit.status, 0, edit.stderr);
      const list = runNm(["provider", "list", "--db", dbPath]);
      assert.match(list.stdout, /openai\t.*\tapiKey: set/);
      assert.doesNotMatch(list.stdout, /super-secret-key-xyz/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("provider use and current persist to state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-provider-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["provider", "list", "--db", dbPath]);
      const use = runNm([
        "provider",
        "use",
        "--providerId",
        "openrouter",
        "--db",
        dbPath,
      ]);
      assert.equal(use.status, 0, use.stderr);
      const cur = runNm(["provider", "current", "--db", dbPath]);
      assert.equal(cur.status, 0, cur.stderr);
      assert.equal(cur.stdout.trim(), "openrouter");
      const state = await readCliState(dbPath);
      assert.equal(state.currentProviderId, "openrouter");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects model request for unsaved model id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-provider-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["provider", "list", "--db", dbPath]);
      const req = runNm([
        "model",
        "request",
        "--modelId",
        "openai/ghost-model",
        "--content",
        "hi",
        "--db",
        dbPath,
      ]);
      assert.notEqual(req.status, 0);
      assert.match(req.stderr, /INVALID_SAVED_MODEL_ID|legacy path|Invalid saved model/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects built-in provider create and protocol edit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-provider-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["provider", "list", "--db", dbPath]);
      const dup = runNm([
        "provider",
        "create",
        "--providerId",
        "openai",
        "--protocol",
        "openai",
        "--baseUrl",
        "https://x.com/v1",
        "--db",
        dbPath,
      ]);
      assert.notEqual(dup.status, 0);
      const edit = runNm([
        "provider",
        "edit",
        "--providerId",
        "openai",
        "--protocol",
        "gemini",
        "--db",
        dbPath,
      ]);
      assert.notEqual(edit.status, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("custom provider create and delete", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-provider-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["provider", "list", "--db", dbPath]);
      const create = runNm([
        "provider",
        "create",
        "--providerId",
        "mygw",
        "--protocol",
        "openai",
        "--baseUrl",
        "https://example.com/v1",
        "--apiKey",
        "gw-key",
        "--db",
        dbPath,
      ]);
      assert.equal(create.status, 0, create.stderr);
      let list = runNm(["provider", "list", "--db", dbPath]);
      assert.match(list.stdout, /mygw/);
      const del = runNm([
        "provider",
        "delete",
        "--providerId",
        "mygw",
        "--db",
        dbPath,
      ]);
      assert.equal(del.status, 0, del.stderr);
      list = runNm(["provider", "list", "--db", dbPath]);
      assert.doesNotMatch(list.stdout, /\bmygw\b/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("saved model use/current and suggest vs saved list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-provider-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["provider", "list", "--db", dbPath]);
      runNm([
        "provider",
        "use",
        "--providerId",
        "openai",
        "--db",
        dbPath,
      ]);
      createSavedModelId(dbPath, "gpt-test");
      const savedModelId = savedModelIdByVendor(dbPath, "gpt-test");
      const use = runNm([
        "model",
        "use",
        "--modelId",
        savedModelId,
        "--db",
        dbPath,
      ]);
      assert.equal(use.status, 0, use.stderr);
      const cur = runNm(["model", "current", "--db", dbPath]);
      assert.equal(cur.stdout.trim(), "openai/gpt-test");
      const topList = runNm(["model", "list", "--db", dbPath]);
      assert.equal(topList.status, 0, topList.stderr);
      assert.match(topList.stdout, new RegExp(`${savedModelId}\\topenai/gpt-test\\tgpt-test`));
      const saved = runNm(["provider", "model", "list", "--db", dbPath]);
      assert.match(saved.stdout, new RegExp(`${savedModelId}\\topenai/gpt-test\\tgpt-test`));
      const suggest = runNm([
        "provider",
        "model",
        "suggest",
        "list",
        "--db",
        dbPath,
      ]);
      assert.equal(suggest.stdout.trim(), "");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
