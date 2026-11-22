import {  describe, it  } from "node:test";
import assert from "node:assert/strict";
import {  AssertionError  } from "../../../src/common/assert.js";
import {  SkspRegistry  } from "../../../src/infra/sksp/logic/registry.js";

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

    it("throws AssertionError when empty", () => {
        SkspRegistry.clear();
        assert.throws(
            () => SkspRegistry.resolve(),
            (e) => e instanceof AssertionError && e.message.includes("SKSP: no driver registered"),
        );
    });
});
