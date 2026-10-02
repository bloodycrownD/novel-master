/**
 * test:collect-guard —— 只跑「收集」这一步并断言非零（wave-e H6 钩子⑥）。
 *
 * 用途：CI 里作为秒级门禁单独跑一条（不起全量测试），跨 shell 验证收集逻辑；
 * 真正的全量运行入口是 `scripts/run-tests.mjs`，它内部也带同一套断言。
 *
 * 牙齿：把 testRoot 指到不存在的目录、或把后缀写成不存在的扩展名 ⇒ 收集数 0 ⇒ exit 1。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNonZeroCollected } from "../../../scripts/lib/zero-collect-guard.mjs";

const cliRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(cliRoot, "test");

function collectTestFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTestFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out.sort();
}

const files = fs.existsSync(testRoot) ? collectTestFiles(testRoot) : [];
console.log(`[collect-check] 扫描面 ${testRoot}（递归 *.test.ts），收集到 ${files.length} 个文件`);
// 守卫本体与 run-tests.mjs 共用仓内 scripts/lib/zero-collect-guard.mjs。
assertNonZeroCollected({
  collected: files.length,
  where: "apps/cli collect-check.mjs",
  details: [`扫描面 ${testRoot}`],
});