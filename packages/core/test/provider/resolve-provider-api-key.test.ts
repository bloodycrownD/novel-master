import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../../src/errors/provider-errors.js";
import {
  BUILTIN_PROVIDER_UUID_OPENAI,
  BUILTIN_PROVIDER_UUID_OPENCODE,
  builtinDefaultApiKey,
} from "../../src/domain/provider/logic/builtin-providers.js";
import {
  providerApiKeyIsConfigured,
  resolveProviderApiKey,
} from "../../src/domain/provider/logic/resolve-provider-api-key.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";

function memorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    async get(ref) {
      return map.get(ref) ?? null;
    },
    async has(ref) {
      return map.has(ref);
    },
    async set(ref, plain) {
      map.set(ref, plain);
    },
    async delete(ref) {
      return map.delete(ref);
    },
  };
}

describe("builtinDefaultApiKey", () => {
  it("returns public for opencode only", () => {
    assert.equal(builtinDefaultApiKey("opencode"), "public");
    assert.equal(builtinDefaultApiKey("openai"), undefined);
  });
});

describe("resolveProviderApiKey", () => {
  it("uses SKSP key when set", async () => {
    const secrets = memorySecretStore();
    await secrets.set(`provider/${BUILTIN_PROVIDER_UUID_OPENAI}/apiKey`, "user-key");
    const key = await resolveProviderApiKey(
      {
        id: BUILTIN_PROVIDER_UUID_OPENAI,
        secretRef: null,
        builtinKey: "openai",
      },
      secrets,
    );
    assert.equal(key, "user-key");
  });

  it("falls back to builtin default for opencode（按 builtin_key）", async () => {
    const secrets = memorySecretStore();
    const key = await resolveProviderApiKey(
      {
        id: BUILTIN_PROVIDER_UUID_OPENCODE,
        secretRef: null,
        builtinKey: "opencode",
      },
      secrets,
    );
    assert.equal(key, "public");
  });

  it("prefers SKSP over builtin default", async () => {
    const secrets = memorySecretStore();
    await secrets.set(
      `provider/${BUILTIN_PROVIDER_UUID_OPENCODE}/apiKey`,
      "paid-key",
    );
    const key = await resolveProviderApiKey(
      {
        id: BUILTIN_PROVIDER_UUID_OPENCODE,
        secretRef: null,
        builtinKey: "opencode",
      },
      secrets,
    );
    assert.equal(key, "paid-key");
  });

  it("throws API_KEY_NOT_SET without sksp or builtin default", async () => {
    const secrets = memorySecretStore();
    await assert.rejects(
      () =>
        resolveProviderApiKey(
          {
            id: BUILTIN_PROVIDER_UUID_OPENAI,
            secretRef: null,
            builtinKey: "openai",
          },
          secrets,
        ),
      (e) => e instanceof ProviderError && e.code === "API_KEY_NOT_SET",
    );
  });
});

describe("providerApiKeyIsConfigured", () => {
  it("is true for opencode without sksp", async () => {
    const secrets = memorySecretStore();
    assert.equal(
      await providerApiKeyIsConfigured(
        {
          id: BUILTIN_PROVIDER_UUID_OPENCODE,
          secretRef: null,
          builtinKey: "opencode",
        },
        secrets,
      ),
      true,
    );
  });

  it("is false for openai without sksp", async () => {
    const secrets = memorySecretStore();
    assert.equal(
      await providerApiKeyIsConfigured(
        {
          id: BUILTIN_PROVIDER_UUID_OPENAI,
          secretRef: null,
          builtinKey: "openai",
        },
        secrets,
      ),
      false,
    );
  });
});
