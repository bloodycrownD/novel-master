import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clearSkspDrivers,
  registerSkspDriver,
  resolveSkspDriver,
} from "../src/registry.js";
import { SkspError } from "../src/sksp-error.js";

describe("SKSP registry", () => {
  it("resolves single registered driver", () => {
    clearSkspDrivers();
    registerSkspDriver({
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
    assert.equal(resolveSkspDriver().name, "test");
    clearSkspDrivers();
  });

  it("throws NOT_REGISTERED when empty", () => {
    clearSkspDrivers();
    assert.throws(
      () => resolveSkspDriver(),
      (e) => e instanceof SkspError && e.code === "NOT_REGISTERED",
    );
  });
});
