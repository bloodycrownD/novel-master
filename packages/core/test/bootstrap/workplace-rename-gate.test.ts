/**
 * T-R5：调用仓库根 scripts/check-workplace-rename-gate.mjs 做改名门禁。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");
const gateScript = join(repoRoot, "scripts/check-workplace-rename-gate.mjs");

describe("T-R5 workplace rename gate", () => {
  it("工程源码无 nm:worktree / core/worktree / 非允许 worktree_dir_rule / GUI 工作树", () => {
    const result = spawnSync(process.execPath, [gateScript], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `gate failed:\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(result.stdout, /workplace rename gate OK/);
  });
});
