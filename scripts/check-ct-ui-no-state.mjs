/**
 * E2 / T-E2-1：Chat Transcript `webview/ui/**` 禁止白名单外值导入 `state`。
 *
 * 策略（钉死于 apps/mobile/README.md「E2：ui 禁值导入 state」）：
 * - 初始 allowlist（值导入 `state`）= StreamTail / RowList / MessageRow
 *   （含 StreamTail 内 StreamBodyHost；同文件）
 * - `import type { … } from '…/state'` 允许（不占白名单）
 * - 白名单外新直读 → exit 1
 *
 * 用法：`node scripts/check-ct-ui-no-state.mjs`
 *       `npm run check:ct-ui-no-state -w @novel-master/mobile`
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const UI_ROOT = join(
  ROOT,
  "apps",
  "mobile",
  "src",
  "web",
  "chat-transcript",
  "webview",
  "ui",
);

/** 相对 UI_ROOT 的 posix 路径；仅这些文件可值导入 `state`。 */
const VALUE_STATE_ALLOWLIST = new Set([
  "stream/StreamTail.tsx",
  "render/RowList.tsx",
  "render/MessageRow.tsx",
]);

const SOURCE_EXT = new Set([".ts", ".tsx"]);

/**
 * @param {string} absDir
 * @param {(absFile: string) => void} visit
 */
function walk(absDir, visit) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = join(absDir, ent.name);
    if (ent.isDirectory()) {
      walk(abs, visit);
      continue;
    }
    if (!ent.isFile()) continue;
    const dot = ent.name.lastIndexOf(".");
    if (dot < 0) continue;
    if (!SOURCE_EXT.has(ent.name.slice(dot))) continue;
    visit(abs);
  }
}

/**
 * 去掉行注释与块注释，降低假阳性（字符串内注释字面量极少出现在 import 行）。
 * @param {string} src
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * 判定 import 源是否指向 CT runtime state 模块。
 * @param {string} spec
 */
function isStateModuleSpecifier(spec) {
  const norm = spec.replace(/\\/g, "/");
  return (
    /(?:^|\/)runtime\/state(?:\/state)?$/.test(norm) ||
    /(?:^|\/)state\/state$/.test(norm) ||
    /(?:^|\/)state$/.test(norm)
  );
}

/**
 * 从 `{ … }` 子句中取出值绑定名（跳过 `type` 修饰与 `typeof`）。
 * @param {string} clause
 * @returns {string[]}
 */
function namedValueBindings(clause) {
  const names = [];
  // 按逗号切；支持 `type Foo`、`Foo as Bar`、`state`
  for (const raw of clause.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    if (/^type\s+/.test(part) || /^typeof\s+/.test(part)) continue;
    const m = part.match(/^([A-Za-z_$][\w$]*)/);
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * @param {string} src
 * @returns {{ line: number, text: string }[]}
 */
function findValueStateImports(src) {
  const cleaned = stripComments(src);
  const hits = [];
  // 捕获：import [type] … from '…'
  const re =
    /\bimport\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const isTypeOnly = Boolean(m[1]);
    const clause = m[2].trim();
    const spec = m[3];
    if (!isStateModuleSpecifier(spec)) continue;
    if (isTypeOnly) continue;

    // side-effect: import '…/state' —— 不视为值导入 state 绑定，跳过
    if (!clause) continue;

    let importsState = false;
    if (clause.startsWith("*")) {
      // import * as X from '…/state' —— 整模块命名空间视为值导入
      importsState = true;
    } else if (clause.startsWith("{")) {
      const inner = clause.replace(/^\{/, "").replace(/\}$/, "");
      importsState = namedValueBindings(inner).includes("state");
    } else {
      // default 或 default + named
      const defaultPart = clause.split("{")[0].trim();
      if (defaultPart) {
        const defName = defaultPart
          .replace(/,$/, "")
          .trim()
          .split(/\s+as\s+/)[0]
          .trim();
        if (defName === "state") importsState = true;
      }
      const brace = clause.match(/\{([\s\S]*)\}/);
      if (brace && namedValueBindings(brace[1]).includes("state")) {
        importsState = true;
      }
    }

    if (!importsState) continue;

    const before = cleaned.slice(0, m.index);
    const line = before.split("\n").length;
    const text = m[0].replace(/\s+/g, " ").trim();
    hits.push({ line, text });
  }
  return hits;
}

function toPosixRel(absFile) {
  return relative(UI_ROOT, absFile).split(sep).join("/");
}

const violations = [];

walk(UI_ROOT, (absFile) => {
  const rel = toPosixRel(absFile);
  if (VALUE_STATE_ALLOWLIST.has(rel)) return;
  const src = readFileSync(absFile, "utf8");
  for (const hit of findValueStateImports(src)) {
    violations.push({
      file: `apps/mobile/src/web/chat-transcript/webview/ui/${rel}`,
      line: hit.line,
      text: hit.text,
    });
  }
});

if (violations.length > 0) {
  console.error(
    "E2 gate failed: value import of `state` outside allowlist in webview/ui/**",
  );
  console.error(
    "Allowlist: stream/StreamTail.tsx, render/RowList.tsx, render/MessageRow.tsx",
  );
  console.error("type-only imports are allowed. See apps/mobile/README.md.");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.text}`);
  }
  process.exit(1);
}

console.log(
  "check-ct-ui-no-state: ok (allowlist StreamTail / RowList / MessageRow only)",
);
process.exit(0);
