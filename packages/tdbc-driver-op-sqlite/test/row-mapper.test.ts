import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RowMapper } from "../src/row-mapper.js";

describe("RowMapper.fromResult", () => {
    it("maps object rows", () => {
        const rows = RowMapper.fromResult({
            rows: [{ id: 1, label: "x" }],
        });
        assert.deepEqual(rows, [{ id: 1, label: "x" }]);
    });

    it("maps array rows with columnNames", () => {
        const rows = RowMapper.fromResult({
            columnNames: ["id", "label"],
            rows: [[2, "y"]],
        });
        assert.deepEqual(rows, [{ id: 2, label: "y" }]);
    });

    it("maps legacy quick-sqlite _array rows with metadata", () => {
        const rows = RowMapper.fromResult({
            metadata: [{ columnName: "path" }],
            rows: {
                _array: [{ path: "/dev/note.md" }],
                length: 1,
                item: (idx) => [{ path: "/dev/note.md" }][idx],
            },
        });
        assert.deepEqual(rows, [{ path: "/dev/note.md" }]);
    });

    it("maps ArrayBuffer blob columns to Uint8Array", () => {
        const blob = new Uint8Array([0, 255, 128]).buffer;
        const rows = RowMapper.fromResult({
            columnNames: ["data"],
            rows: [[blob]],
        });
        assert.ok(rows[0]!.data instanceof Uint8Array);
        assert.deepEqual([...(rows[0]!.data as Uint8Array)], [0, 255, 128]);
    });
});
