import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

const CORE_SRC = join(import.meta.dirname, "../../src");

/** 递归收集 core 源码目录下全部 .ts 文件。 */
async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(fullPath)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("bootstrap 无历史 migrate（T-B2）", () => {
  it("源码中不存在 migrate-*.ts 模块文件", async () => {
    const files = await collectTsFiles(CORE_SRC);
    const migrateFiles = files.filter((file) =>
      file.replace(/\\/g, "/").includes("/migrate-"),
    );
    assert.deepEqual(
      migrateFiles,
      [],
      `不应存在 migrate 模块：${migrateFiles.join(", ")}`,
    );
  });

  it("源码中不存在 migrate- 模块 import", async () => {
    const files = await collectTsFiles(CORE_SRC);
    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (
        /from\s+["'][^"']*migrate-[^"']*["']/.test(text) ||
        /import\s*\(\s*["'][^"']*migrate-[^"']*["']/.test(text)
      ) {
        offenders.push(file);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `以下文件仍 import migrate 模块：${offenders.join(", ")}`,
    );
  });
});
