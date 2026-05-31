import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createModelSamplingProfileService,
  createProviderServices,
  modelSamplingProfileFromJson,
} from "@novel-master/core";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

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

describe("ModelSamplingProfileService", () => {
  it("P1: set/get/clear KKV profile", async () => {
    const ctx = await openNovelMasterTestConnection();
    try {
      const profiles = createModelSamplingProfileService(ctx.conn);
      const profile = modelSamplingProfileFromJson({
        schemaVersion: 1,
        enabled: true,
        params: { protocol: "openai", openai: { temperature: 0.3 } },
      });
      await profiles.setProfile("zhipu/glm-4.6", profile);
      const loaded = await profiles.getProfile("zhipu/glm-4.6");
      assert.equal(loaded?.enabled, true);
      assert.equal(loaded?.params?.protocol === "openai" && loaded.params.openai.temperature, 0.3);
      await profiles.clearProfile("zhipu/glm-4.6");
      assert.equal(await profiles.getProfile("zhipu/glm-4.6"), null);
    } finally {
      await ctx.conn.close();
    }
  });

  it("P4: deleteSaved clears sampling profile", async () => {
    const ctx = await openNovelMasterTestConnection();
    try {
      const bundle = createProviderServices(ctx.conn, memorySecretStore());
      await bundle.providerModels.create("openai", "sampling-test");
      await bundle.modelSamplingProfiles.setProfile(
        "openai/sampling-test",
        modelSamplingProfileFromJson({
          schemaVersion: 1,
          enabled: true,
          params: { protocol: "openai", openai: { temperature: 0.5 } },
        }),
      );
      await bundle.providerModels.deleteSaved("openai", "sampling-test");
      assert.equal(await bundle.modelSamplingProfiles.getProfile("openai/sampling-test"), null);
    } finally {
      await ctx.conn.close();
    }
  });
});
