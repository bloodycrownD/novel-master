import {  describe, it  } from "node:test";
import assert from "node:assert/strict";
import {  Kkv  } from "../../src/common/kkv.js";

describe("Kkv.parseBoolean / Kkv.formatBoolean", () => {
    it("parses \"true\" / \"false\"", () => {
        assert.equal(Kkv.parseBoolean("true"), true);
        assert.equal(Kkv.parseBoolean("false"), false);
    });

    it("returns null for anything else（调用方自带错误码与文案）", () => {
        assert.equal(Kkv.parseBoolean("yes"), null);
        assert.equal(Kkv.parseBoolean(""), null);
        assert.equal(Kkv.parseBoolean("TRUE"), null);
    });

    it("formats booleans for KKV storage", () => {
        assert.equal(Kkv.formatBoolean(true), "true");
        assert.equal(Kkv.formatBoolean(false), "false");
    });

    it("parse / format 互为逆运算", () => {
        for (const value of [true, false]) {
            assert.equal(Kkv.parseBoolean(Kkv.formatBoolean(value)), value);
        }
    });
});
