#!/usr/bin/env node
/**
 * 全量函数盘点（symbols inventory）——AST 扫描，无论是否 export 都收。
 *
 * 用途：为「重复函数合并 / 通用工具抽取」提供确定性数据。
 * 产出：
 *   <out>/<name>.jsonl     每函数一条：名字/文件:行/是否 export/JSDoc/签名/token 数/归一化 hash
 *   <out>/<name>-dups.md   重复簇报告：精确重复（同归一化 body）+ 跨文件近似重复（token 4-gram Jaccard）
 *   stdout                 摘要：总数、分布、簇数、跨包引用信号
 *
 * 用法：
 *   node scripts/symbols-inventory.mjs                          # packages/core/src
 *   node scripts/symbols-inventory.mjs packages/core/src/domain
 *   node scripts/symbols-inventory.mjs --out tmp --sim 0.8 --min-tokens 25
 *
 * 口径：
 * - 收集 FunctionDeclaration / 箭头函数与函数表达式 / 类方法 / 对象字面量方法 / 嵌套局部函数；
 *   访问器与构造器不收（属性语义）。
 * - exported 只认声明处 export 修饰（barrel 转发不改变声明处口径）。
 * - 注释取声明锚的 leading comment（JSDoc 与行注释），截 300 字。
 * - 精确重复：去注释去空白后的 body sha1 相同（token ≥ min-tokens）。
 * - 近似重复：跨文件、token 数差 ≤25%、4-gram Jaccard ≥ sim；同文件近似不报（噪声高）。
 * - 引用信号：名字在 core src / apps src 出现的文件数（词边界匹配，粗粒度启发式）。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const args = process.argv.slice(2);
const outArgIdx = args.indexOf("--out");
const outDir = outArgIdx >= 0 ? path.resolve(args[outArgIdx + 1]) : path.resolve("tmp");
const simArgIdx = args.indexOf("--sim");
const SIM = simArgIdx >= 0 ? Number(args[simArgIdx + 1]) : 0.8;
const minArgIdx = args.indexOf("--min-tokens");
const MIN_TOKENS = minArgIdx >= 0 ? Number(args[minArgIdx + 1]) : 25;
const sufArgIdx = args.indexOf("--suffix");
const SUFFIX = sufArgIdx >= 0 ? args[sufArgIdx + 1] : "";
const targetArg = args.find((a, i) => !a.startsWith("--") && i !== outArgIdx + 1 && i !== simArgIdx + 1 && i !== minArgIdx + 1 && i !== sufArgIdx + 1) ?? "packages/core/src";

const repoRoot = process.cwd();
const targetPath = path.resolve(repoRoot, targetArg);
const SOURCE_EXT = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".worktree", "coverage", "__pycache__"]);

function walk(entry, out = []) {
  const stat = fs.statSync(entry);
  if (stat.isFile()) {
    if (SOURCE_EXT.has(path.extname(entry))) out.push(entry);
    return out;
  }
  for (const name of fs.readdirSync(entry)) {
    if (!SKIP_DIRS.has(name)) walk(path.join(entry, name), out);
  }
  return out;
}

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

function tokenize(text) {
  return text.match(/[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|\S/g) ?? [];
}

function stripCommentsAndWs(sf, sourceText, bodyNode) {
  // 取 body 源文本 → 删除注释 → 删除全部空白
  const start = bodyNode.getStart(sf);
  const end = bodyNode.getEnd();
  let text = sourceText.slice(start, end);
  text = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n\r]*/g, " ");
  return text.replace(/\s+/g, "");
}

function leadingComments(sourceText, node) {
  const ranges = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? [];
  return ranges
    .map((r) => sourceText.slice(r.pos, r.end).trim())
    .join("\n")
    .slice(0, 300);
}

function shinglesOf(tokens) {
  const out = new Set();
  for (let i = 0; i + 4 <= tokens.length; i++) out.add(tokens.slice(i, i + 4).join(" "));
  return out;
}

function jaccard(a, b) {
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const isFnLike = (n) =>
  ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n);

function enclosingIsFn(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (isFnLike(p) || ts.isConstructorDeclaration(p)) return true;
  }
  return false;
}

/** 包装判定：body 无控制流、≤2 条语句、恰好 1 个调用 → 记被调名（冗余包装候选信号） */
function wrapperInfo(body) {
  let stmts = 0;
  let calls = 0;
  let control = 0;
  let callee = null;
  const visit = (n) => {
    if (ts.isReturnStatement(n) || ts.isExpressionStatement(n)) stmts++;
    if (
      ts.isIfStatement(n) || ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) ||
      ts.isWhileStatement(n) || ts.isDoStatement(n) || ts.isTryStatement(n) || ts.isSwitchStatement(n)
    ) control++;
    if (ts.isCallExpression(n)) {
      calls++;
      if (!callee && ts.isIdentifier(n.expression)) callee = n.expression.text;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  if (control === 0 && calls === 1 && stmts <= 2 && callee) return { callee };
  return { callee: null };
}

/** 收集一个 sourceFile 里的全部函数记录 */
function collectFile(absPath) {
  const text = fs.readFileSync(absPath, "utf8");
  const sf = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true);
  const rel = path.relative(repoRoot, absPath).replace(/\\/g, "/");
  const records = [];

  const visit = (node) => {
    let rec = null;
    if (ts.isFunctionDeclaration(node) && node.body) {
      rec = mkRec(node, node.body, node.name?.text ?? "(anonymous)", node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false, "function");
    } else if (ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      const fn = node.initializer;
      const stmt = node.parent?.parent;
      const exported = ts.isVariableStatement(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      const name = ts.isIdentifier(node.name) ? node.name.text : "(destructured)";
      rec = mkRec(stmt ?? node, fn.body, name, exported, "arrow", fn);
    } else if (ts.isMethodDeclaration(node) && node.body) {
      const inObjLit = node.parent && ts.isObjectLiteralExpression(node.parent);
      const name = node.name.getText(sf);
      rec = mkRec(node, node.body, name, false, inObjLit ? "objectFn" : "method");
    }
    if (rec) records.push(rec);
    ts.forEachChild(node, visit);
  };
  visit(sf);

  function mkRec(anchor, body, name, exported, kind, fnNode) {
    const tokens = tokenize(body.getText(sf));
    const norm = stripCommentsAndWs(sf, text, body);
    const jsDoc = leadingComments(text, anchor);
    const paramsSrc = fnNode ? fnNode.parameters.map((p) => p.getText(sf)).join(", ") : "";
    const retType = fnNode?.type ? fnNode.type.getText(sf) : "";
    const wrap = wrapperInfo(body);
    return {
      name,
      kind,
      nested: enclosingIsFn(anchor),
      exported,
      file: rel,
      line: text.slice(0, anchor.getStart(sf)).split("\n").length,
      params: paramsSrc,
      retType,
      jsDoc,
      keepLocal: /keep-local/i.test(jsDoc),
      tokens: tokens.length,
      lines: text.slice(body.getStart(sf), body.getEnd()).split("\n").length,
      normHash: sha1(norm),
      shingles: shinglesOf(tokens),
      wrapperCallee: wrap.callee,
    };
  }
  return records;
}

/** 引用信号：名字出现的文件数（core src 与 apps src 分开，词边界匹配） */
function referenceSignals(names) {
  const unique = [...new Set(names.filter((n) => /^[A-Za-z_$][\w$]{2,}$/.test(n)))];
  const coreFiles = walk(path.join(repoRoot, "packages/core/src"));
  const appFiles = [];
  for (const app of ["apps/mobile/src", "apps/desktop/src", "apps/desktop/renderer", "apps/desktop/shared", "apps/cli/src"]) {
    const p = path.join(repoRoot, app);
    if (fs.existsSync(p)) appFiles.push(...walk(p));
  }
  const bigRe = new RegExp("\\b(" + unique.map((n) => n.replace(/\$/g, "\\$")).join("|") + ")\\b", "g");
  const counts = new Map();
  for (const files of [[coreFiles, "core"], [appFiles, "apps"]]) {
    const [list, tag] = files;
    const seenPerFile = new Map();
    for (const f of list) {
      const t = fs.readFileSync(f, "utf8");
      let m;
      bigRe.lastIndex = 0;
      while ((m = bigRe.exec(t))) {
        let e = seenPerFile.get(m[1]);
        if (!e) { e = { core: 0, apps: 0 }; seenPerFile.set(m[1], e); }
        e[tag]++;
      }
    }
    for (const [name, e] of seenPerFile) {
      const c = counts.get(name) ?? { core: 0, apps: 0 };
      c[tag] = e[tag];
      counts.set(name, c);
    }
  }
  return counts;
}

// ---------- 主流程 ----------
const files = walk(targetPath);
const all = files.flatMap(collectFile);
const eligible = all.filter((r) => r.tokens >= MIN_TOKENS);

// 精确重复
const byHash = new Map();
for (const r of eligible) {
  const list = byHash.get(r.normHash) ?? [];
  list.push(r);
  byHash.set(r.normHash, list);
}
const exactClusters = [...byHash.values()].filter((l) => l.length > 1);

// 近似重复（跨文件）
const approx = [];
const sorted = [...eligible].sort((a, b) => a.tokens - b.tokens);
for (let i = 0; i < sorted.length; i++) {
  for (let j = i + 1; j < sorted.length && sorted[j].tokens <= sorted[i].tokens * 1.25 + 8; j++) {
    const a = sorted[i];
    const b = sorted[j];
    if (a.file === b.file) continue;
    const sim = jaccard(a.shingles, b.shingles);
    if (sim >= SIM) approx.push({ a, b, sim });
  }
}

// 引用信号（只对参与簇的名字查，控制成本）
const clusterNames = new Set();
for (const c of exactClusters) c.forEach((r) => clusterNames.add(r.name));
for (const p of approx) { clusterNames.add(p.a.name); clusterNames.add(p.b.name); }
const refs = referenceSignals([...clusterNames]);

// ---------- 输出 ----------
fs.mkdirSync(outDir, { recursive: true });
const base = "core-symbols" + SUFFIX;
const jsonlPath = path.join(outDir, base + ".jsonl");
fs.writeFileSync(
  jsonlPath,
  all.map((r) => { const { shingles, ...rest } = r; return JSON.stringify(rest); }).join("\n"),
  "utf8"
);

const fmt = (r) => {
  const ref = refs.get(r.name);
  return `- \`${r.file}:${r.line}\` **${r.name}** (${r.kind}${r.exported ? ", exported" : ""}${r.nested ? ", nested" : ""}${r.keepLocal ? ", keep-local" : ""}) ${r.tokens}t${ref ? ` — refs core:${ref.core} apps:${ref.apps}` : ""}${r.jsDoc ? `\n  > ${r.jsDoc.replace(/\n/g, " ").slice(0, 160)}` : ""}`;
};

const md = [];
md.push("# core 函数盘点 — 重复簇报告");
md.push("");
md.push(`- 扫描：\`${targetArg}\`（${files.length} 文件，函数 ${all.length} 个，参与聚类 ${eligible.length} 个，阈值 token≥${MIN_TOKENS} / sim≥${SIM}）`);
md.push(`- 全量清单：\`${jsonlPath}\``);
md.push("");
md.push(`## 精确重复（归一化 body 相同）：${exactClusters.length} 簇`);
for (const c of exactClusters) {
  md.push("");
  md.push(`### 簇（${c.length} 处，${c[0].tokens}t）`);
  c.forEach((r) => md.push(fmt(r)));
}
md.push("");
md.push(`## 跨文件近似重复（Jaccard ≥ ${SIM}）：${approx.length} 对`);
for (const p of approx.sort((x, y) => y.sim - x.sim).slice(0, 60)) {
  md.push("");
  md.push(`### ${(p.sim * 100).toFixed(0)}%（${p.a.tokens}t / ${p.b.tokens}t）`);
  md.push(fmt(p.a));
  md.push(fmt(p.b));
}
if (approx.length > 60) md.push(`\n（其余 ${approx.length - 60} 对见 jsonl，按相似度排序截断）`);

// 跨文件同名（不看 body 相似度；同名即候选，由 LLM 定性）
const NOISE_METHOD_NAMES = new Set([
  "get", "set", "has", "find", "delete", "remove", "update", "clear", "map", "run", "init",
  "create", "build", "parse", "format", "apply", "exec", "load", "save", "read", "write",
  "open", "close", "start", "stop", "reset", "dispose", "validate", "visit", "chat", "call",
]);
const byName = new Map();
for (const r of all) {
  if (!/^[A-Za-z_$][\w$]*$/.test(r.name)) continue;
  if ((r.kind === "method" || r.kind === "objectFn") && NOISE_METHOD_NAMES.has(r.name)) continue;
  const l = byName.get(r.name) ?? [];
  l.push(r);
  byName.set(r.name, l);
}
const sameNameGroups = [...byName.values()].filter((l) => new Set(l.map((r) => r.file)).size > 1);
md.push("");
md.push(`## 跨文件同名（不看 body 相似度，同名即候选）：${sameNameGroups.length} 组`);
for (const g of sameNameGroups.sort((a, b) => b.length - a.length)) {
  const sameBody = new Set(g.map((r) => r.normHash)).size === 1;
  md.push("");
  md.push(`### ${g[0].name}（${g.length} 处${sameBody ? "，body 全同" : "，body 有差异"}）`);
  g.forEach((r) => md.push(fmt(r)));
}

// 包装信号：单转调 body
const wrappers = all.filter((r) => r.wrapperCallee);
const exportedNames = new Set(all.filter((r) => r.exported).map((r) => r.name));
const wrapOfPublic = wrappers.filter((r) => exportedNames.has(r.wrapperCallee) && r.wrapperCallee !== r.name);
const byCallee = new Map();
for (const w of wrappers) {
  const l = byCallee.get(w.wrapperCallee) ?? [];
  l.push(w);
  byCallee.set(w.wrapperCallee, l);
}
const dupWrappers = [...byCallee.values()].filter((l) => new Set(l.map((r) => r.file)).size > 1);
md.push("");
md.push(`## 包装信号：共 ${wrappers.length} 个单转调函数`);
md.push("");
md.push(`### 包装「已导出公共函数」的包装层：${wrapOfPublic.length} 个（可能是域门面，也可能是冗余）`);
wrapOfPublic.forEach((r) => md.push(`- \`${r.file}:${r.line}\` **${r.name}** → 转调 ${r.wrapperCallee}`));
md.push("");
md.push(`### 多文件重复包装同一目标：${dupWrappers.length} 组`);
for (const g of dupWrappers) {
  md.push("");
  md.push(`### 目标 ${g[0].wrapperCallee}（${g.length} 处包装）`);
  g.forEach((r) => md.push(`- \`${r.file}:${r.line}\` **${r.name}** → ${r.wrapperCallee}`));
}
const mdPath = path.join(outDir, base + "-dups.md");
fs.writeFileSync(mdPath, md.join("\n"), "utf8");

// stdout 摘要
const kindStat = {};
for (const r of all) kindStat[r.kind] = (kindStat[r.kind] ?? 0) + 1;
console.log(`files=${files.length} fns=${all.length} eligible=${eligible.length}`);
console.log(`kinds: ${Object.entries(kindStat).map(([k, v]) => k + "=" + v).join(" ")}`);
console.log(`exported=${all.filter((r) => r.exported).length} nested=${all.filter((r) => r.nested).length} keepLocal=${all.filter((r) => r.keepLocal).length}`);
console.log(`exactClusters=${exactClusters.length} (${exactClusters.reduce((s, c) => s + c.length, 0)} 处)`);
console.log(`approxPairs=${approx.length}`);
console.log(`sameNameGroups=${sameNameGroups.length} wrappers=${wrappers.length} wrapOfPublic=${wrapOfPublic.length} dupWrappers=${dupWrappers.length}`);
console.log(`jsonl=${jsonlPath}`);
console.log(`report=${mdPath}`);
