import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const fixtureRoot = path.join(repoRoot, "packages/core/src/__style_fixture__");
const testFixtureRoot = path.join(repoRoot, "packages/core/test/__style_fixture__");
const script = path.join(repoRoot, ".agents/skills/nm-code-style/scripts/find-fake-exports.mjs");

test("find-fake-exports：经 barrel 的调用点 / 测试引用 / 类型引用都能计数", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.rmSync(testFixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.mkdirSync(testFixtureRoot, { recursive: true });
  try {
    fs.writeFileSync(path.join(fixtureRoot, "defs.ts"), [
      "export function oneCall(): void {}",
      "export function twoCalls(): void {}",
      "export function deadCall(): void {}",
      "export function publicOne(): void {}",
      "/** nm-style: keep-public — 跨层唯一入口 fixture */",
      "export function keptPublic(): void {}",
      "export type DeadType = string;",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixtureRoot, "barrel.ts"), [
      'export { oneCall, twoCalls, deadCall, publicOne, keptPublic } from "./defs.js";',
      'export type { DeadType } from "./defs.js";',
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixtureRoot, "consumer.ts"), [
      'import { oneCall, twoCalls, publicOne, keptPublic, type DeadType } from "./barrel.js";',
      'const typed: DeadType = "x";',
      "oneCall();",
      "twoCalls();",
      "twoCalls();",
      "publicOne();",
      "keptPublic();",
      "void typed;",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(testFixtureRoot, "consumer.test.ts"), [
      'import { deadCall } from "../src/__style_fixture__/barrel.js";',
      "deadCall();",
      "",
    ].join("\n"));
    const fixtureSnapshot = path.join(repoRoot, "packages/core/test/package-exports/snapshots/__style_fixture__.json");
    fs.writeFileSync(fixtureSnapshot, JSON.stringify(["publicOne", "keptPublic"]));

    const out = execFileSync(process.execPath, [script, "packages/core/src/__style_fixture__/defs.ts"], { cwd: repoRoot, encoding: "utf8" });
    assert.match(out, /INLINE_CANDIDATE\s+1c\/0r\s+0c\/0r\s+.*oneCall/);
    assert.match(out, /KEEP\s+2c\/0r\s+0c\/0r\s+.*twoCalls/);
    assert.match(out, /TEST_ONLY\s+0c\/0r\s+1c\/0r\s+.*deadCall/);
    assert.match(out, /INLINE_CANDIDATE\s+1c\/0r\s+0c\/0r\s+yes\s+.*publicOne/);
    assert.match(out, /KEEP\s+1c\/0r\s+0c\/0r\s+yes\s+.*keptPublic/);
    assert.match(out, /KEEP\s+0c\/1r\s+0c\/0r\s+.*DeadType/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(testFixtureRoot, { recursive: true, force: true });
    fs.rmSync(path.join(repoRoot, "packages/core/test/package-exports/snapshots/__style_fixture__.json"), { force: true });
  }
});
