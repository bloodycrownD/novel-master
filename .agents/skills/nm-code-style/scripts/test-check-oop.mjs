import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const fixtureRoot = path.join(repoRoot, "tmp", "__oop_fixture__");
const script = path.join(repoRoot, ".agents/skills/nm-code-style/scripts/check-oop.mjs");

test("check-oop：共享状态模块报 OOP_CANDIDATE，纯函数多导出只报 MANY_EXPORTS", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  try {
    fs.writeFileSync(path.join(fixtureRoot, "state.ts"), [
      "const bySession = new Map<string, string>();",
      "const listeners = new Set<(id: string) => void>();",
      "export function add(id: string): void { bySession.set(id, id); listeners.forEach((fn) => fn(id)); }",
      "export function list(id: string): string | undefined { return bySession.get(id); }",
      "export function clear(id: string): void { bySession.delete(id); }",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixtureRoot, "pure.ts"), [
      "export function a(): void {}",
      "export function b(): void {}",
      "export function c(): void {}",
      "export function d(): void {}",
      "export function e(): void {}",
      "export function f(): void {}",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixtureRoot, "object.ts"), [
      "class Store {",
      "  private readonly byId = new Map<string, string>();",
      "  add(id: string): void { this.byId.set(id, id); }",
      "}",
      "export const store = new Store();",
      "",
    ].join("\n"));

    const result = spawnSync(process.execPath, [script, fixtureRoot, "--json"], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    const rows = JSON.parse(result.stdout);
    assert.deepEqual(rows.map((row) => [row.verdict, path.basename(row.location)]), [
      ["MANY_EXPORTS", "pure.ts:1"],
      ["OOP_CANDIDATE", "state.ts:1"],
    ]);
    assert.ok(rows.every((row) => !row.location.includes("object.ts")));
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
