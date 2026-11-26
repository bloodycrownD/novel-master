import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  SqlTemplateParser  } from "@/infra/sql-template/index.js";

describe("SqlTemplateParser e2e", () => {
    const parser = new SqlTemplateParser();

    it("#1 static SQL unchanged with empty parameters", () => {
        const sql = "SELECT * FROM user";
        const r = parser.parse(sql, { unused: true });
        assert.ok(r.ok);
        assert.equal(r.value.sql, sql);
        assert.deepEqual(r.value.parameters, []);
    });

    it("#2 hash placeholder becomes ? with bound value", () => {
        const r = parser.parse("AND col = #{col}", { col: 10 });
        assert.ok(r.ok);
        assert.ok(r.value.sql.includes("?"));
        assert.deepEqual(r.value.parameters, [10]);
    });

    it("#3 dollar placeholder embeds string without parameters", () => {
        const r = parser.parse("ORDER BY ${orderBy}", { orderBy: "id DESC" });
        assert.ok(r.ok);
        assert.ok(r.value.sql.includes("id DESC"));
        assert.deepEqual(r.value.parameters, []);
    });

    it("#17 static text preserves a < b", () => {
        const r = parser.parse("SELECT * FROM t WHERE a < b", {});
        assert.ok(r.ok);
        assert.equal(r.value.sql, "SELECT * FROM t WHERE a < b");
    });
});
