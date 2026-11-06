/**
 * 守卫：desktop 的 `src/main` 下零裸 console 调用（白名单为空）。
 *
 * sink 的失败兜底走 `process.stderr.write`，不经 console——否则守卫与
 * 「sink 内不能再调 logger」的防递归约定会互相打架。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_DIR = path.join(__dirname, "..", "src", "main");
const RAW_CONSOLE_CALL = /\bconsole\.(log|info|warn|error|debug|trace)\s*\(/;

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("desktop main no-raw-console", () => {
  it("src/main 下 console 调用命中 = 0", () => {
    const hits: string[] = [];
    for (const file of listTsFiles(MAIN_DIR)) {
      readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
        if (RAW_CONSOLE_CALL.test(line)) hits.push(`${path.relative(MAIN_DIR, file)}:${index + 1}`);
      });
    }
    assert.deepEqual(hits, []);
  });
});
