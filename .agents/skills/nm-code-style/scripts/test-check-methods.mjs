import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const fixtureRoot = path.join(repoRoot, "tmp", "__methods_fixture__");
const script = path.join(repoRoot, ".agents/skills/nm-code-style/scripts/check-methods.mjs");

test("check-methods：类内方法检 dead / inline / pass-through / deprecated", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  try {
    fs.writeFileSync(path.join(fixtureRoot, "demo.ts"), [
      "class Demo {",
      "  private unused(): void {}",
      "  private once(): void { this.used(); }",
      "  public used(): void { this.once(); }",
      "  public wrap(value: string): string { return this.pick(value); }",
      "  private pick(value: string): string { return value; }",
      "  /** @deprecated */",
      "  public legacyNeverCalledXyz(): void {}",
      "}",
      "new Demo().used();",
      "new Demo().wrap('x');",
      "",
    ].join("\n"));

    const result = spawnSync(process.execPath, [script, path.join(fixtureRoot, "demo.ts"), "--json"], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    const verdicts = JSON.parse(result.stdout).map((row) => row.verdict);
    assert.ok(verdicts.includes("DEAD_METHOD"));
    assert.ok(verdicts.includes("INLINE_METHOD"));
    assert.ok(verdicts.includes("PASS_THROUGH_METHOD"));
    assert.ok(verdicts.includes("DEPRECATED_DEAD"));
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
