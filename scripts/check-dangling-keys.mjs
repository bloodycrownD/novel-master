// 波 4 收敛：悬空键核验——generated-catalog 全量键在 src 面（apps+packages，排除测试豁免口径外的面）零命中者。
// 消费判定：任何文件（含 __tests__ 源码契约锁）出现键字面量即算消费。
import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";

const root = process.cwd();
const catalogSrc = readFileSync("packages/core/src/i18n/generated-catalog.ts", "utf8");
const keys = [...catalogSrc.matchAll(/"([a-z_]+(?:\.[a-z0-9_]+)+)":/g)].map(match => match[1]);
const uniqueKeys = [...new Set(keys)];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "build", ".rnstorybook", "tmp", ".reference"]);
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function walk(dir, files) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, files);
    } else if (EXTS.has(name.slice(name.lastIndexOf(".")))) {
      files.push(p);
    }
  }
}

const files = [];
walk(join(root, "apps"), files);
walk(join(root, "packages"), files);
walk(join(root, "scripts"), files);
walk(join(root, "tools"), files);

const corpus = files.map(p => readFileSync(p, "utf8"));
const dangling = [];
for (const key of uniqueKeys) {
  const needle = `"${key}"`;
  if (!corpus.some(src => src.includes(needle))) dangling.push(key);
}

console.log(`keys=${uniqueKeys.length} scanned-files=${files.length} dangling=${dangling.length}`);
for (const key of dangling) console.log(`  ${key}`);
