import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const CORE_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src",
);

/** 已退役的进程内 capture / BlockStore API（生产源码不得再引用）。 */
const FORBIDDEN_CAPTURE_PATTERNS: readonly { label: string; re: RegExp }[] = [
  { label: "worktreeBlockStore.capture(", re: /worktreeBlockStore\.capture\s*\(/ },
  {
    label: "captureSessionWorktreeBlock(",
    re: /captureSessionWorktreeBlock\s*\(/,
  },
  {
    label: "getCapturedBlockOrCapture(",
    re: /getCapturedBlockOrCapture\s*\(/,
  },
  {
    label: "createSessionWorktreeBlockStore(",
    re: /createSessionWorktreeBlockStore\s*\(/,
  },
  {
    label: "SessionWorktreeBlockStore",
    re: /\bSessionWorktreeBlockStore\b/,
  },
];

/** 须经 assembleWorkplaceDisplay 的生产入口（相对 CORE_SRC）。 */
const MUST_ASSEMBLE = [
  "service/agent/impl/agent-runner.ts",
] as const;

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

describe("workplace assemble allowlist (retire capture)", () => {
  it("T-MAU-RC1：生产源码无 BlockStore / capture / lazy API", async () => {
    const files = await collectTsFiles(CORE_SRC);
    const violations: string[] = [];

    for (const file of files) {
      const rel = path.relative(CORE_SRC, file).replace(/\\/g, "/");
      const source = await readFile(file, "utf8");
      for (const { label, re } of FORBIDDEN_CAPTURE_PATTERNS) {
        if (re.test(source)) {
          violations.push(`${rel}: ${label}`);
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `以下生产源码仍引用已退役 capture：\n${violations.join("\n")}`,
    );
  });

  it("T-MAU-RC2：agent-runner 须调用 assembleWorkplaceDisplay", async () => {
    for (const rel of MUST_ASSEMBLE) {
      const source = await readFile(path.join(CORE_SRC, rel), "utf8");
      assert.match(
        source,
        /assembleWorkplaceDisplay\s*\(/,
        `${rel} 须调用 assembleWorkplaceDisplay`,
      );
      assert.doesNotMatch(
        source,
        /getCapturedBlockOrCapture\s*\(/,
        `${rel} 不得调用 getCapturedBlockOrCapture`,
      );
    }
  });
});
