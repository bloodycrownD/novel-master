import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  RequestAbort, AbortError  } from "../../../src/infra/llm-protocol/logic/request-abort.js";

describe("request-abort", () => {
    it("isAbortLikeError matches Error.name AbortError without DOMException", () => {
        const g = globalThis as { DOMException?: typeof DOMException };
        const saved = g.DOMException;
        // @ts-expect-error Hermes has no DOMException
        delete g.DOMException;
        try {
            const err = new Error("aborted");
            err.name = "AbortError";
            assert.equal(RequestAbort.isAbortLikeError(err), true);
            assert.equal(RequestAbort.isAbortLikeError(new Error("other")), false);
        } finally {
            if (saved !== undefined) {
                g.DOMException = saved;
            }
        }
    });

    it("AbortError.create works without DOMException global", () => {
        const g = globalThis as { DOMException?: typeof DOMException };
        const saved = g.DOMException;
        // @ts-expect-error Hermes has no DOMException
        delete g.DOMException;
        try {
            const err = AbortError.create("cancelled");
            assert.equal(err.name, "AbortError");
            assert.equal(err.message, "cancelled");
            assert.equal(RequestAbort.isAborted(err), true);
        } finally {
            if (saved !== undefined) {
                g.DOMException = saved;
            }
        }
    });
});
