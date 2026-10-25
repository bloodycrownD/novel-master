import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const fixture = path.join(repoRoot, "tmp", "__signature_fixture__.ts");
const script = path.join(repoRoot, ".agents/skills/nm-code-style/scripts/check-signatures.mjs");

test("check-signatures：单参数/单实参/单 import 与 const/赋值拆行都能检测", () => {
  fs.mkdirSync(path.dirname(fixture), { recursive: true });
  try {
    fs.writeFileSync(fixture, [
      "export function one(",
      "  x: string",
      "): string { return x; }",
      "one(",
      '  "x"',
      ");",
      "import {",
      "  one",
      '} from "./one.js";',
      "const moved =",
      "  compute();",
      "const binary = a +",
      "  b;",
      "const object = {",
      "  a: 1,",
      "};",
      "const array = [",
      "  1,",
      "];",
      "const arrow = () =>",
      "  1;",
      "target =",
      "  value;",
      "",
    ].join("\n"));

    const result = spawnSync(process.execPath, [script, fixture, "--json"], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    const rows = JSON.parse(result.stdout);
    const kinds = rows.map((row) => row.kind);
    assert.equal(kinds.filter((kind) => kind === "PARAMS").length, 1);
    assert.equal(kinds.filter((kind) => kind === "ARGS").length, 1);
    assert.equal(kinds.filter((kind) => kind === "IMPORT").length, 1);
    assert.equal(kinds.filter((kind) => kind === "ASSIGN").length, 1);
    assert.deepEqual(rows.filter((row) => row.kind === "VARDECL").map((row) => row.detail).sort(), ["binary", "moved"]);
    assert.ok(!kinds.includes("object"));
    assert.ok(!rows.some((row) => ["object", "array", "arrow"].includes(row.detail)));
  } finally {
    fs.rmSync(fixture, { force: true });
  }
});
