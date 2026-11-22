import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  StreamFinalRate  } from "../../../src/domain/format/stream-final-rate.js";

describe("stream-final-rate（session KKV 冻结速率快照编解码）", () => {
    it("往返：序列化后解析回同值", () => {
        const snapshot = { rate: 96.7, tokens: 12_000, atMs: 1_790_395_828_168 };
        const raw = StreamFinalRate.serializeSnapshot(snapshot);
        assert.deepEqual(StreamFinalRate.parseSnapshot(raw), snapshot);
    });

    it("缺失/空串/损坏 JSON/非对象 → null（展示层据此省略速率段）", () => {
        assert.equal(StreamFinalRate.parseSnapshot(null), null);
        assert.equal(StreamFinalRate.parseSnapshot(undefined), null);
        assert.equal(StreamFinalRate.parseSnapshot(""), null);
        assert.equal(StreamFinalRate.parseSnapshot("{"), null);
        assert.equal(StreamFinalRate.parseSnapshot("null"), null);
        assert.equal(StreamFinalRate.parseSnapshot('"96.7"'), null);
    });

    it("rate 非法（缺字段/非数值/负数/非有限）→ null，不造数", () => {
        assert.equal(StreamFinalRate.parseSnapshot('{"tokens":1,"atMs":2}'), null);
        assert.equal(StreamFinalRate.parseSnapshot('{"rate":"96.7"}'), null);
        assert.equal(StreamFinalRate.parseSnapshot('{"rate":-1}'), null);
        assert.equal(StreamFinalRate.parseSnapshot('{"rate":null}'), null);
    });

    it("tokens/atMs 缺字段退化为 0（只服务自检，不影响速率段）", () => {
        assert.deepEqual(StreamFinalRate.parseSnapshot('{"rate":12.5}'), {
            rate: 12.5,
            tokens: 0,
            atMs: 0,
        });
    });
});
