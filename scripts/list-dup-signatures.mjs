#!/usr/bin/env node
/**
 * 提取非导出函数签名，按签名分组，把重复的排在一起。
 *
 * 动机：判断「有没有重复实现」时，看代码很难，看签名列表很容易——
 * 同名同参的两个私有函数在不同文件里，签名会挨在一起。
 *
 * 用法：
 *   node scripts/list-dup-signatures.mjs <repo-root> [--base main] [--all] [--json]
 *   node scripts/list-dup-signatures.mjs <repo-root> --all --write-baseline
 *   node scripts/list-dup-signatures.mjs <repo-root> --all --gate
 *
 *   <repo-root>       仓库根（可以是 worktree）
 *   --base            比较基线，默认 main；--all 则扫全仓 src 而非仅变动文件
 *   --json            输出 JSON 便于后续处理
 *   --write-baseline  把当前重复组写进 scripts/dup-signatures-baseline.json
 *   --gate            与基线比对：**新增重复组即 FIND（exit 1）**，存量允许保留
 *
 * 定位：与 check-style 的 exports / oop 段同级——**REVIEW 级门禁，不要求归零，
 * 但要求「不许比基线更差」**。重复不必然该合并（双端镜像对、测试自包含 helper
 * 都是刻意重复），所以判据是增量而不是存量。
 *
 * 与 prettier 的关系：不要对全仓跑 prettier，见 scripts/prettier-guard.mjs。
 *
 * 收集范围（**export 与非 export 一视同仁**）：
 *   - 所有顶层 function 声明（标注 `export` 与否）
 *   - 所有顶层 const/let 箭头函数与函数表达式
 *   - class 内所有方法（带 `ClassName.method`）
 *   - class 内所有箭头函数属性
 * 不含：getter/setter、constructor、interface/type 签名。
 *
 * 为什么必须含 export：跨域重复的典型形态是「一处 export、另一处私有」
 * （如 `scope-prefix-helpers.ts` 的 export `normalizePrefix` 与
 * `vfs-tree-copy.ts` 的私有同名函数）。只扫非 export 会漏掉这种配对。
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const root = process.argv[2];
if (!root) {
  console.error("用法: node scripts/list-dup-signatures.mjs <repo-root> [--base main] [--all] [--json]");
  process.exit(2);
}
const args = process.argv.slice(3);
const base = (() => {
  const i = args.indexOf("--base");
  return i >= 0 && args[i + 1] ? args[i + 1] : "main";
})();
const scanAll = args.includes("--all");
const asJson = args.includes("--json");

function listFiles() {
  // Windows 的 cmd 不认单引号：`git diff ... -- '*.ts'` 里的引号会被当字面字符，
  // 导致 lstat pathspec 匹配不到任何文件。路径过滤一律放到 JS 侧做。
  const out = scanAll
    ? execSync("git ls-files packages apps", { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 })
    : execSync(`git diff --name-only ${base}..HEAD`, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.endsWith(".d.ts"))
    .filter((f) => (scanAll ? f.includes("/src/") : f.includes("/src/") || f.includes("/test/")))
    // apps/cli 已停止维护（见 memory #276）：不纳入任何代码质量判据
    .filter((f) => !f.startsWith("apps/cli/"));
}

const hasMod = (node, kind) => (node.modifiers ?? []).some((m) => m.kind === kind);
const isExported = (node) =>
  hasMod(node, ts.SyntaxKind.ExportKeyword) || (node.parent && ts.isExportDeclaration(node.parent ?? {}));

function paramText(p, sf) {
  const name = p.name.getText(sf).replace(/\s+/g, " ");
  const opt = p.questionToken ? "?" : "";
  const rest = p.dotDotDotToken ? "..." : "";
  const type = p.type ? `: ${p.type.getText(sf).replace(/\s+/g, " ")}` : "";
  return `${rest}${name}${opt}${type}`;
}

function retText(node, sf) {
  return node.type ? `: ${node.type.getText(sf).replace(/\s+/g, " ")}` : "";
}

/** 参数列表去掉默认值后训一化，便于跨文件比对。 */
function signatureOf(name, params, ret) {
  return `${name}(${params.join(", ")})${ret}`;
}

const records = [];
function push(file, sf, node, kind, name, params, ret, line, exported) {
  records.push({
    file,
    line,
    kind,
    name,
    exported,
    signature: signatureOf(name, params, ret),
    // 分组键：忽略名字与返回类型，只看「参数形态」——重复实现最常表现为此相同
    shapeKey: `(${params.join(", ").replace(/[A-Za-z_$][\w$]*:/g, ":")})`,
  });
}

function walk(node, sf, file) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    const params = node.parameters.map((p) => paramText(p, sf));
    push(file, sf, node, "function", node.name.getText(sf), params, retText(node, sf), sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, isExported(node));
  }
  if (ts.isVariableStatement(node)) {
    const stmtExported = isExported(node);
    for (const d of node.declarationList.declarations) {
      const init = d.initializer;
      if (!init || (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init))) continue;
      const params = init.parameters.map((p) => paramText(p, sf));
      push(file, sf, d, "const-fn", d.name.getText(sf), params, retText(init, sf), sf.getLineAndCharacterOfPosition(d.getStart(sf)).line + 1, stmtExported);
    }
  }
  if (ts.isClassDeclaration(node) && node.name) {
    const cls = node.name.getText(sf);
    for (const m of node.members) {
      if (ts.isMethodDeclaration(m) && m.name) {
        const kind = hasMod(m, ts.SyntaxKind.PrivateKeyword) ? "method-private" : "method";
        const params = m.parameters.map((p) => paramText(p, sf));
        push(file, sf, m, kind, `${cls}.${m.name.getText(sf)}`, params, retText(m, sf), sf.getLineAndCharacterOfPosition(m.getStart(sf)).line + 1, isExported(node));
      }
      if (ts.isPropertyDeclaration(m) && m.name && m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))) {
        const kind = hasMod(m, ts.SyntaxKind.PrivateKeyword) ? "prop-fn-private" : "prop-fn";
        const params = m.initializer.parameters.map((p) => paramText(p, sf));
        push(file, sf, m, kind, `${cls}.${m.name.getText(sf)}`, params, retText(m.initializer, sf), sf.getLineAndCharacterOfPosition(m.getStart(sf)).line + 1, isExported(node));
      }
    }
  }
  ts.forEachChild(node, (c) => walk(c, sf, file));
}

const files = listFiles();
for (const f of files) {
  let src;
  try {
    src = readFileSync(join(root, f), "utf8");
  } catch {
    continue;
  }
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  walk(sf, sf, f);
}

// 三种分组视图，各有用途
const byName = new Map();
const byShape = new Map();
const bySig = new Map();
for (const r of records) {
  if (!byName.has(r.name)) byName.set(r.name, []);
  byName.get(r.name).push(r);
  if (!byShape.has(r.shapeKey)) byShape.set(r.shapeKey, []);
  byShape.get(r.shapeKey).push(r);
  if (!bySig.has(r.signature)) bySig.set(r.signature, []);
  bySig.get(r.signature).push(r);
}

const writeBaseline = args.includes("--write-baseline");
const gate = args.includes("--gate");
const BASELINE = new URL("./dup-signatures-baseline.json", import.meta.url);

/** 只把 src 侧的重复计入基线：测试 helper 的自包含重复是刻意设计，不参与门禁。 */
function collectDupGroups() {
  const isSrc = (site) => site.includes("/src/");
  const named = [...byName.entries()].filter(([, v]) => v.length > 1 && v.every((r) => isSrc(r.file)));
  const shaped = [...byShape.entries()].filter(([, v]) => v.length > 1 && v.every((r) => isSrc(r.file)));
  return {
    // 组键：同名 / 同参数形态；值取排序后的站点集合，用于判「是不是同一批」
    named: Object.fromEntries(named.map(([k, v]) => [k, v.map((r) => `${r.file}:${r.line}`).sort()])),
    shaped: Object.fromEntries(shaped.map(([k, v]) => [k, v.map((r) => `${r.file}:${r.line}`).sort()])),
  };
}

if (writeBaseline) {
  const cur = collectDupGroups();
  const payload = {
    note: "签名重复基线。新增重复组会让 --gate 打红；存量允许保留（刻意重复：双端镜像对、测试 helper、接口实现）。",
    namedGroups: Object.keys(cur.named).length,
    shapedGroups: Object.keys(cur.shaped).length,
    named: cur.named,
    shaped: cur.shaped,
  };
  writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + String.fromCharCode(10), "utf8");
  console.log("已写基线：" + payload.namedGroups + " 组同名 / " + payload.shapedGroups + " 组同参数形态 → " + BASELINE.pathname);
  process.exit(0);
}

if (gate) {
  let base;
  try {
    base = JSON.parse(readFileSync(BASELINE, "utf8"));
  } catch {
    console.error("基线不存在：" + BASELINE.pathname + "。先跑 --write-baseline。");
    process.exit(2);
  }
  const cur = collectDupGroups();
  const addedNamed = Object.keys(cur.named).filter((k) => !(k in base.named));
  const addedShaped = Object.keys(cur.shaped).filter((k) => !(k in base.shaped));
  const goneNamed = Object.keys(base.named).filter((k) => !(k in cur.named));
  const goneShaped = Object.keys(base.shaped).filter((k) => !(k in cur.shaped));
  console.log("dup-signatures: 同名 " + Object.keys(base.named).length + "→" + Object.keys(cur.named).length + "（新增 " + addedNamed.length + " / 消除 " + goneNamed.length + "）");
  console.log("dup-signatures: 形态 " + Object.keys(base.shaped).length + "→" + Object.keys(cur.shaped).length + "（新增 " + addedShaped.length + " / 消除 " + goneShaped.length + "）");
  if (addedNamed.length) {
    console.log(String.fromCharCode(10) + "[新增同名重复]——要么合并，要么在报告说明为什么必须各留一份：");
    for (const k of addedNamed) {
      console.log("  " + k);
      for (const site of cur.named[k]) console.log("     " + site);
    }
  }
  if (addedShaped.length) {
    console.log(String.fromCharCode(10) + "[新增同形态重复]（名字不同但参数一模一样，最可能是改名复制）：");
    for (const k of addedShaped.slice(0, 20)) {
      console.log("  " + k);
      for (const site of cur.shaped[k]) console.log("     " + site);
    }
  }
  if (goneNamed.length) console.log(String.fromCharCode(10) + "[已消除同名重复] " + goneNamed.length + " 组：" + goneNamed.join(", "));
  if (goneShaped.length) console.log("[已消除同形态重复] " + goneShaped.length + " 组");
  const bad = addedNamed.length + addedShaped.length;
  console.log(String.fromCharCode(10) + "dup-signatures: " + (bad === 0 ? "PASS（无新增重复）" : "FIND（新增 " + bad + " 组，需人工判定：合并 or 说明保留理由）"));
  process.exit(bad === 0 ? 0 : 1);
}

if (asJson) {
  const out = {
    scannedFiles: files.length,
    totalSymbols: records.length,
    dupByName: [...byName.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ name: k, count: v.length, sites: v.map((r) => `${r.file}:${r.line}`), exported: v.map((r) => r.exported === true) })),
    dupByShape: [...byShape.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ shape: k, count: v.length, sites: v.map((r) => `${r.name} @ ${r.file}:${r.line}`), exported: v.map((r) => r.exported === true) })),
    dupBySignature: [...bySig.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ signature: k, count: v.length, sites: v.map((r) => `${r.file}:${r.line}`), exported: v.map((r) => r.exported === true) })),
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

function section(title, note, groups) {
  console.log(`\n${"═".repeat(78)}\n${title}\n${note}\n${"─".repeat(78)}`);
  if (groups.length === 0) {
    console.log("  （无）");
    return;
  }
  for (const [key, list] of groups.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    console.log(`\n${list.length}×  ${key}`);
    for (const r of list) console.log(`     ${r.exported ? "[export]" : "[local] "} ${r.file}:${r.line}   [${r.kind}] ${r.name}`);
  }
}

console.log(`扫描 ${files.length} 个文件（${scanAll ? "全仓 src" : `${base}..HEAD 变动`}），提取到 ${records.length} 个非导出符号`);
console.log(`去重后：按名 ${byName.size} 种、按参数形态 ${byShape.size} 种、按完整签名 ${bySig.size} 种`);

section("① 同名不同文件（最可能是重复实现）", "私有函数在不同文件里取了同一个名字——优先看这里。", [...byName.entries()].filter(([, v]) => v.length > 1));
section("② 参数形态相同（名字不同但干同一件事）", "忽略函数名与返回类型后的参数列表完全一致——跨文件复制粘贴改名的典型痕迹。", [...byShape.entries()].filter(([, v]) => v.length > 1));
section("③ 完整签名相同", "名字 + 参数 + 返回类型全一样。", [...bySig.entries()].filter(([, v]) => v.length > 1));

const singles = [...bySig.entries()].filter(([, v]) => v.length === 1).map(([k]) => k);
if (singles.length && singles.length <= 80) {
  console.log(`\n${"═".repeat(78)}\n④ 唯一签名（${singles.length} 个，仅供参考）\n${"─".repeat(78)}`);
  for (const s of singles.sort()) console.log(`  ${s}`);
}
