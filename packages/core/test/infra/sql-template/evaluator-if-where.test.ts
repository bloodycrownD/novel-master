import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  SqlTemplateParser  } from "@/infra/sql-template/index.js";

describe("evaluator if / where", () => {
    const parser = new SqlTemplateParser();

    it("#4 if true includes body", () => {
        const r = parser.parse(
            "SELECT 1<if test=\"enabled\"> AND status = 1</if>",
            { enabled: true },
        );
        assert.ok(r.ok);
        assert.ok(r.value.sql.includes("AND status = 1"));
    });

    it("#4 if false omits body", () => {
        const r = parser.parse(
            "SELECT 1<if test=\"enabled\"> AND status = 1</if>",
            { enabled: false },
        );
        assert.ok(r.ok);
        assert.ok(!r.value.sql.includes("AND status = 1"));
    });

    it("#5 missing property is falsy without throw", () => {
        const r = parser.parse(
            '<if test="missing != null">AND x = 1</if>',
            {},
        );
        assert.ok(r.ok);
        assert.ok(!r.value.sql.includes("AND x = 1"));
        assert.equal(r.value.parameters.length, 0);
    });

    it("#6 where strips AND and adds WHERE", () => {
        const r = parser.parse(
            "SELECT * FROM user <where><if test=\"id\">AND id = #{id}</if></where>",
            { id: 42 },
        );
        assert.ok(r.ok);
        assert.ok(r.value.sql.includes("WHERE id = ?"));
        assert.ok(!r.value.sql.includes("AND id"));
        assert.deepEqual(r.value.parameters, [42]);
    });

    it("#7 where with all false if emits no WHERE", () => {
        const r = parser.parse(
            "SELECT * FROM user <where><if test=\"id\">AND id = #{id}</if></where>",
            {},
        );
        assert.ok(r.ok);
        assert.ok(!r.value.sql.includes("WHERE"));
    });
});
