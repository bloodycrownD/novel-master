import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SkspRegistry } from "../../../src/infra/sksp/logic/registry.js";
import { SkspError } from "../../../src/infra/sksp/sksp-error.js";

describe("SKSP registry", () => {
  it("resolves single registered driver", () => {
    SkspRegistry.clear();
    SkspRegistry.register({
      name: "test",
      createStore: () => ({
        async get() {
          return null;
        },
        async set() {},
        async delete() {
          return false;
        },
        async has() {
          return false;
        },
      }),
    });
    assert.equal(SkspRegistry.resolve().name, "test");
    SkspRegistry.clear();
  });

  it("throws NOT_REGISTERED when empty", () => {
    SkspRegistry.clear();
    assert.throws(
      () => SkspRegistry.resolve(),
      (e) => e instanceof SkspError && e.code === "NOT_REGISTERED",
    );
  });
});
