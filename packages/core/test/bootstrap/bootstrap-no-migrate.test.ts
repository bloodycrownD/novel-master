import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SCHEMA_MIGRATIONS } from "../../src/bootstrap/schema-migrations/index.js";

const CORE_SRC = join(import.meta.dirname, "../../src");
const SCHEMA_MIGRATIONS_DIR = join(
  CORE_SRC,
  "bootstrap/schema-migrations",
);

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

/** schema-migrations 目录内实现 migration 的模块（排除基础设施文件）。 */
const SCHEMA_MIGRATION_INFRA = new Set([
  "index.ts",
  "schema-migration.types.ts",
  "schema-migrations-table.ts",
]);

describe("bootstrap 无历史 migrate（T-B2 / T-SM10）", () => {
  it("源码中不存在未登记的 migrate-*.ts 模块（schema-migrations 外）", async () => {
    const files = await collectTsFiles(CORE_SRC);
    const migrateFiles = files.filter((file) => {
      const normalized = file.replace(/\\/g, "/");
      if (!normalized.includes("/migrate-")) {
        return false;
      }
      return !normalized.includes("/bootstrap/schema-migrations/");
    });
    assert.deepEqual(
      migrateFiles,
      [],
      `不应存在未登记目录下的 migrate 模块：${migrateFiles.join(", ")}`,
    );
  });

  it("源码中不存在 migrate- 模块 import（schema-migrations 登记模块除外）", async () => {
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
      `以下文件仍 import 未登记的 migrate 模块：${offenders.join(", ")}`,
    );
  });

  it("SCHEMA_MIGRATIONS 注册 id 唯一", () => {
    const ids = SCHEMA_MIGRATIONS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("schema-migrations 目录内 migration 模块均已注册", async () => {
    const entries = await readdir(SCHEMA_MIGRATIONS_DIR, {
      withFileTypes: true,
    });
    const migrationModules = entries
      .filter((e) => e.isFile() && e.name.endsWith(".ts"))
      .map((e) => e.name)
      .filter((name) => !SCHEMA_MIGRATION_INFRA.has(name));

    const registeredIds = new Set(SCHEMA_MIGRATIONS.map((m) => m.id));

    for (const fileName of migrationModules) {
      const stem = fileName.replace(/\.ts$/, "");
      assert.ok(
        registeredIds.has(stem),
        `schema-migrations/${fileName} 须在 SCHEMA_MIGRATIONS 注册（id=${stem}）`,
      );
    }
  });
});
