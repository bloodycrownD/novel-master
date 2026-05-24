import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { refToEnvVar } from "../src/ref-to-env.js";
import { EnvSecretStore } from "../src/env-secret-store.js";

describe("refToEnvVar", () => {
  it("maps provider apiKey refs", () => {
    assert.equal(
      refToEnvVar("provider/openai/apiKey"),
      "NOVEL_MASTER_PROVIDER_OPENAI_API_KEY",
    );
    assert.equal(
      refToEnvVar("provider/my-gw/apiKey"),
      "NOVEL_MASTER_PROVIDER_MY_GW_API_KEY",
    );
    assert.equal(refToEnvVar("other/ref"), null);
  });
});

describe("EnvSecretStore", () => {
  const key = "NOVEL_MASTER_PROVIDER_OPENAI_API_KEY";

  beforeEach(() => {
    delete process.env[key];
  });

  afterEach(() => {
    delete process.env[key];
  });

  it("returns env value when set", async () => {
    process.env[key] = "sk-test";
    const store = new EnvSecretStore();
    assert.equal(await store.get("provider/openai/apiKey"), "sk-test");
    assert.equal(await store.has("provider/openai/apiKey"), true);
  });

  it("returns null when unset", async () => {
    const store = new EnvSecretStore();
    assert.equal(await store.get("provider/openai/apiKey"), null);
    assert.equal(await store.has("provider/openai/apiKey"), false);
  });
});
