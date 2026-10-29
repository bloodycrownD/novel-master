import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/** 已知 config-forms 泄漏；收敛后从此清单移除。 */
const KNOWN_LEAKS = new Set<string>();

const PUBLIC_DIR = join(import.meta.dirname, "../../src/public");
const SRC_DIR = join(import.meta.dirname, "../../src");

describe("public/* 架构守卫", () => {
  it("除 KNOWN_LEAKS 外不得 import config-forms", () => {
    for (const file of readdirSync(PUBLIC_DIR).filter((f) =>
      f.endsWith(".ts")
    )) {
      const src = readFileSync(join(PUBLIC_DIR, file), "utf8");
      const importsConfigForms = /from\s+["'].*config-forms/.test(src);
      if (importsConfigForms && !KNOWN_LEAKS.has(file)) {
        assert.fail(`${file} 不得依赖 config-forms`);
      }
    }
  });

  it("src/config-forms 目录不存在（已迁出 core，防复活）", () => {
    assert.equal(existsSync(join(SRC_DIR, "config-forms")), false);
  });
});
