import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * C1 守卫：core 的 `src/**` 里不得出现裸 console 调用。
 *
 * 口径与 spec §1.1 一致——**调用形态**正则（带 `\s*\(`），注释里裸写
 * `console.warn` 不算命中。白名单只含内置 console sink 自身
 * （`src/infra/log/logger.ts`）：sink 里再调 logger 会在失败路径无限递归。
 */
const CALL_FORM = /\bconsole\.(log|info|warn|error|debug|trace)\s*\(/;
const SRC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src");
const ALLOWED = new Set(["infra/log/logger.ts"]);

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (item.isFile() && item.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/** 相对 `src/` 的 posix 路径。 */
function relativeToSrc(full: string): string {
  return path.relative(SRC_ROOT, full).split(path.sep).join("/");
}

describe("C1 no-raw-console 守卫", () => {
  it("src/**/*.ts 的 console 调用点只在 infra/log/logger.ts", () => {
    const offenders: string[] = [];
    const scanned: string[] = [];
    for (const file of collectTsFiles(SRC_ROOT)) {
      const rel = relativeToSrc(file);
      scanned.push(rel);
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (CALL_FORM.test(line) && !ALLOWED.has(rel)) {
            offenders.push(`${rel}:${index + 1}`);
          }
        });
    }
    // 扫描面守卫：文件没收集到会静默恒真。
    assert.ok(scanned.length > 100, `扫描面异常：只收到 ${scanned.length} 个文件`);
    assert.ok(scanned.includes("infra/log/logger.ts"), "内置 console sink 应在扫描面内（白名单的唯一成员）");
    assert.deepEqual(offenders, [], `core 裸 console 调用点（应改走 createLogger）：${offenders.join(", ")}`);
  });
});
