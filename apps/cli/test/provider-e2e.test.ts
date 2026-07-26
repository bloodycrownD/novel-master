/**
 * Provider / model CLI e2e（T-PI6 / T-PI7：provider-identity 新合同）。
 *
 * @module test/provider-e2e
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  BUILTIN_OPENAI_UUID,
  BUILTIN_OPENROUTER_UUID,
  createSavedModelId,
  parseCreatedProviderId,
  parseProviderList,
  readCliState,
  runNm,
  savedModelIdByVendor,
  stripBootLogs,
} from "./helpers.js";

describe("provider CLI e2e", () => {
  it("lists five built-in providers with uuid and displayName", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-provider-"));
    const dbPath = join(dir, "novel.db");
    try {
      const list = runNm(["provider", "list", "--db", dbPath]);
      assert.equal(list.status, 0, list.stderr);
      const rows = parseProviderList(list.stdout);
      assert.equal(rows.length, 5);
      const byId = new Map(rows.map((r) => [r.id, r]));
      assert.equal(byId.get(BUILTIN_OPENAI_UUID)?.displayName, "OpenAI");
      assert.equal(byId.get(BUILTIN_OPENROUTER_UUID)?.displayName, "OpenRouter");
      assert.match(list.stdout, /OpenAI/);
      assert.match(list.stdout, /Anthropic/);
      assert.match(list.stdout, /Google Gemini/);
      assert.match(list.stdout, /OpenRouter/);
      assert.match(list.stdout, /OpenCode Zen/);
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
        BUILTIN_OPENAI_UUID,
        "--apiKey",
        "super-secret-key-xyz",
        "--db",
        dbPath,
      ]);
      assert.equal(edit.status, 0, edit.stderr);
      const list = runNm(["provider", "list", "--db", dbPath]);
      assert.match(
        list.stdout,
        new RegExp(`${BUILTIN_OPENAI_UUID}\\tOpenAI\\t.*\\tapiKey: set`),
      );
      assert.doesNotMatch(list.stdout, /super-secret-key-xyz/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("provider use and current persist name with uuid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-provider-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["provider", "list", "--db", dbPath]);
      const use = runNm([
        "provider",
        "use",
        "--providerId",
        BUILTIN_OPENROUTER_UUID,
        "--db",
        dbPath,
      ]);
      assert.equal(use.status, 0, use.stderr);
      const cur = runNm(["provider", "current", "--db", dbPath]);
      assert.equal(cur.status, 0, cur.stderr);
      assert.equal(stripBootLogs(cur.stdout), `OpenRouter\t${BUILTIN_OPENROUTER_UUID}`);
      const state = await readCliState(dbPath);
      assert.equal(state.currentProviderId, BUILTIN_OPENROUTER_UUID);
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

  it("create requires --name; edit --name empty fails; builtin protocol locked", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-provider-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["provider", "list", "--db", dbPath]);
      // T-PI7：旧 `--providerId` slug create 不再作为成功路径（缺 --name 即失败）
      const oldSlugCreate = runNm([
        "provider",
        "create",
        "--providerId",
        "mygw",
        "--protocol",
        "openai",
        "--baseUrl",
        "https://example.com/v1",
        "--db",
        dbPath,
      ]);
      assert.notEqual(oldSlugCreate.status, 0);
      assert.match(oldSlugCreate.stderr, /--name/);

      const missingName = runNm([
        "provider",
        "create",
        "--protocol",
        "openai",
        "--baseUrl",
        "https://example.com/v1",
        "--db",
        dbPath,
      ]);
      assert.notEqual(missingName.status, 0);

      const emptyEditName = runNm([
        "provider",
        "edit",
        "--providerId",
        BUILTIN_OPENAI_UUID,
        "--name",
        "   ",
        "--db",
        dbPath,
      ]);
      assert.notEqual(emptyEditName.status, 0);
      assert.match(emptyEditName.stderr, /INVALID_ARGUMENT|不能为空/);

      const editProtocol = runNm([
        "provider",
        "edit",
        "--providerId",
        BUILTIN_OPENAI_UUID,
        "--protocol",
        "gemini",
        "--db",
        dbPath,
      ]);
      assert.notEqual(editProtocol.status, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("custom provider create/delete by uuid; clears currentModel via getSavedById", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-provider-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["provider", "list", "--db", dbPath]);
      const create = runNm([
        "provider",
        "create",
        "--name",
        "My Gateway",
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
      const providerId = parseCreatedProviderId(create.stderr);
      assert.match(
        providerId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      let list = runNm(["provider", "list", "--db", dbPath]);
      assert.match(list.stdout, new RegExp(`${providerId}\\tMy Gateway\\t`));

      const rename = runNm([
        "provider",
        "edit",
        "--providerId",
        providerId,
        "--name",
        "Renamed GW",
        "--db",
        dbPath,
      ]);
      assert.equal(rename.status, 0, rename.stderr);
      list = runNm(["provider", "list", "--db", dbPath]);
      assert.match(list.stdout, new RegExp(`${providerId}\\tRenamed GW\\t`));

      runNm(["provider", "use", "--providerId", providerId, "--db", dbPath]);
      const savedModelId = createSavedModelId(dbPath, "gw-model", providerId);
      runNm(["model", "use", "--modelId", savedModelId, "--db", dbPath]);
      let state = await readCliState(dbPath);
      assert.equal(state.currentModelId, savedModelId);
      assert.equal(state.currentProviderId, providerId);

      const del = runNm([
        "provider",
        "delete",
        "--providerId",
        providerId,
        "--db",
        dbPath,
      ]);
      assert.equal(del.status, 0, del.stderr);
      list = runNm(["provider", "list", "--db", dbPath]);
      assert.doesNotMatch(list.stdout, new RegExp(providerId));
      assert.doesNotMatch(list.stdout, /Renamed GW/);
      state = await readCliState(dbPath);
      assert.equal(state.currentProviderId, undefined);
      assert.equal(state.currentModelId, undefined);
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
        BUILTIN_OPENAI_UUID,
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
      assert.equal(stripBootLogs(cur.stdout), "OpenAI/gpt-test");
      const topList = runNm(["model", "list", "--db", dbPath]);
      assert.equal(topList.status, 0, topList.stderr);
      assert.match(
        topList.stdout,
        new RegExp(`${savedModelId}\\tOpenAI/gpt-test\\tgpt-test`),
      );
      const saved = runNm(["provider", "model", "list", "--db", dbPath]);
      assert.match(
        saved.stdout,
        new RegExp(`${savedModelId}\\tOpenAI/gpt-test\\tgpt-test`),
      );
      const suggest = runNm([
        "provider",
        "model",
        "suggest",
        "list",
        "--db",
        dbPath,
      ]);
      assert.equal(stripBootLogs(suggest.stdout), "");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
