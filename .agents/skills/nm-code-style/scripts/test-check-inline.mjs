import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const fixtureRoot = path.join(repoRoot, "tmp", "__inline_fixture__");
const script = path.join(repoRoot, ".agents/skills/nm-code-style/scripts/check-inline.mjs");

test("check-inline：长函数 keep-local 保留；行数不是理由，小函数仍判内联", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  try {
    fs.writeFileSync(path.join(fixtureRoot, "large.ts"), [
      "/** nm-style: keep-local — 管线阶段 */",
      "function large(): number {",
      "  let total = 0;",
      ...Array.from({ length: 22 }, (_, index) => `  total += ${index};`),
      "  return total;",
      "}",
      "export const value = large();",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixtureRoot, "small.ts"), [
      "/** nm-style: keep-local — 不应豁免小函数 */",
      "function small(): number { return 1; }",
      "export const smallValue = small();",
      "",
    ].join("\n"));

    const large = spawnSync(process.execPath, [script, path.join(fixtureRoot, "large.ts"), "--json"], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(large.status, 0);
    assert.equal(JSON.parse(large.stdout)[0].verdict, "KEEP_LOCAL");

    const small = spawnSync(process.execPath, [script, path.join(fixtureRoot, "small.ts"), "--json"], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(small.status, 1);
    assert.equal(JSON.parse(small.stdout)[0].verdict, "INLINE_LOCAL");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("check-inline：f(x.trim()) 这类带简单参数变换的薄包装也判 PASS_THROUGH", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  try {
    fs.writeFileSync(path.join(fixtureRoot, "passthrough.ts"), [
      "declare function resolve(path: string): string;",
      "export function normalize(path: string): string {",
      "  return resolve(path.trim());",
      "}",
      "",
    ].join("\n"));

    const result = spawnSync(process.execPath, [script, path.join(fixtureRoot, "passthrough.ts"), "--json"], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).some((row) => row.verdict === "PASS_THROUGH"));
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
