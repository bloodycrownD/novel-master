import {  describe, it, beforeEach, afterEach  } from "node:test";
import assert from "node:assert/strict";
import {  SkspRefToEnv  } from "../../../src/infra/sksp/logic/ref-to-env.js";
import {  SkspFactory  } from "../../../src/infra/sksp/impl/sksp-factory.js";

describe("refToEnvVar", () => {
  it("maps provider apiKey refs", () => {
    assert.equal(
      SkspRefToEnv.toEnvVar("provider/openai/apiKey"),
      "NOVEL_MASTER_PROVIDER_OPENAI_API_KEY",
    );
    assert.equal(
      SkspRefToEnv.toEnvVar("provider/my-gw/apiKey"),
      "NOVEL_MASTER_PROVIDER_MY_GW_API_KEY",
    );
    assert.equal(SkspRefToEnv.toEnvVar("other/ref"), null);
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
    const store = SkspFactory.createEnvSecretStore();
    assert.equal(await store.get("provider/openai/apiKey"), "sk-test");
    assert.equal(await store.has("provider/openai/apiKey"), true);
  });

  it("returns null when unset", async () => {
    const store = SkspFactory.createEnvSecretStore();
    assert.equal(await store.get("provider/openai/apiKey"), null);
    assert.equal(await store.has("provider/openai/apiKey"), false);
  });

  it("treats empty string as unset", async () => {
    process.env[key] = "";
    const store = SkspFactory.createEnvSecretStore();
    assert.equal(await store.get("provider/openai/apiKey"), null);
    assert.equal(await store.has("provider/openai/apiKey"), false);
  });

  it("treats whitespace-only as unset", async () => {
    process.env[key] = "   ";
    const store = SkspFactory.createEnvSecretStore();
    assert.equal(await store.get("provider/openai/apiKey"), null);
    assert.equal(await store.has("provider/openai/apiKey"), false);
  });
});
