import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const CORE_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src",
);

/** 允许直接调用 SessionWorktreeBlockStore.capture 的生产源码路径（相对 CORE_SRC）。 */
const CAPTURE_ALLOWLIST = new Set([
  "service/prompt/capture-session-worktree-block.ts",
  "service/prompt/impl/session-worktree-block-store.service.ts",
]);

async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("worktree block capture allowlist", () => {
  it("T-WEC17：白名单外生产源码无 worktreeBlockStore.capture", async () => {
    const files = await collectTsFiles(CORE_SRC);
    const violations: string[] = [];

    for (const file of files) {
      const rel = path.relative(CORE_SRC, file).replace(/\\/g, "/");
      if (CAPTURE_ALLOWLIST.has(rel)) {
        continue;
      }
      const source = await readFile(file, "utf8");
      if (/worktreeBlockStore\.capture\s*\(/.test(source)) {
        violations.push(rel);
      }
    }

    assert.deepEqual(
      violations,
      [],
      `以下文件直调 worktreeBlockStore.capture，应改经 captureSessionWorktreeBlock：\n${violations.join("\n")}`,
    );
  });
});
