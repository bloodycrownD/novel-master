#!/usr/bin/env node
/**
 * 导出仓库全部函数签名（export 与非 export 一视同仁），供人工或 agent 做两类审查：
 *
 *   ① 语义重复审查（配合 `list-dup-signatures.mjs` 的三种视图）
 *   ② OOP 聚合审查（看「哪些函数族在操作同一个实体/上下文」）
 *
 * 为什么需要导出全部签名：读代码看不出「这 5 个函数干的是同一件事」——它们往往
 * 名字不同、分散在不同文件。但把 1500 个签名排在一起，「同参同返回」「同一首参
 * 反复出现」的模式肉眼可辨。这是只靠签名就能发现的，不需要读实现。
 *
 * 用法：
 *   node scripts/list-all-signatures.mjs <repo-root> [--out <path>] [--changed|--all]
 *
 *   <repo-root>  仓库根（可以是 worktree）
 *   --all        扫全仓 `packages/* /src` 与 `apps/* /src`（默认）
 *   --changed    只扫 `--base` 以来的变动文件
 *   --base       配合 --changed，默认 main
 *   --out        输出路径，默认 D:/tmp/all-signatures.txt
 *
 * 收集范围：顶层 function、顶层 const/let 箭头函数与函数表达式、class 方法、
 * class 箭头函数属性。不含 getter/setter / constructor / interface 签名。
 * `apps/cli/` 已停止维护，一律排除。
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

const root = process.argv[2];
if (!root) {
  console.error("用法: node scripts/list-all-signatures.mjs <repo-root> [--out <path>] [--changed] [--base main] [--all]");
  process.exit(2);
}
const argv = process.argv.slice(3);
const argOf = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const scanChanged = argv.includes("--changed");
const base = argOf("--base", "main");
const outPath = argOf("--out", "D:/tmp/all-signatures.txt");

const raw = scanChanged
  ? execSync(`git diff --name-only ${base}..HEAD`, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 })
  : execSync("git ls-files packages apps", { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
const files = raw
  .split("\n")
  .map((f) => f.trim())
  .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.endsWith(".d.ts"))
  .filter((f) => f.includes("/src/"))
  .filter((f) => !f.startsWith("apps/cli/"));

const hasMod = (node, kind) => (node.modifiers ?? []).some((m) => m.kind === kind);
const isExported = (node) => hasMod(node, ts.SyntaxKind.ExportKeyword);
const oneLine = (s) => s.replace(/\s+/g, " ");

function paramText(p, sf) {
  const rest = p.dotDotDotToken ? "..." : "";
  const name = oneLine(p.name.getText(sf));
  const opt = p.questionToken ? "?" : "";
  const type = p.type ? ": " + oneLine(p.type.getText(sf)) : "";
  return rest + name + opt + type;
}
const retText = (node, sf) => (node.type ? ": " + oneLine(node.type.getText(sf)) : "");

const rows = [];
for (const f of files) {
  let src;
  try {
    src = readFileSync(join(root, f), "utf8");
  } catch {
    continue;
  }
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const at = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  (function walk(node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      rows.push([f, at(node), (isExported(node) ? "export " : "") + "function " + node.name.getText(sf) + "(" + node.parameters.map((p) => paramText(p, sf)).join(", ") + ")" + retText(node, sf)]);
    }
    if (ts.isVariableStatement(node)) {
      const ex = isExported(node) ? "export " : "";
      for (const d of node.declarationList.declarations) {
        const init = d.initializer;
        if (!init) continue;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          rows.push([f, at(d), ex + "const " + d.name.getText(sf) + " = (" + init.parameters.map((p) => paramText(p, sf)).join(", ") + ")" + retText(init, sf)]);
          continue;
        }
        // 引用别名：`export const X = Y.member`（不是函数定义，四个 check 脚本都抓不到）。
        // 换名别名（X !== member）是「假抽象层」：不增代码量、有消费者、名字平行。
        // 只认**模块顶层 + export** 的：函数体内的 `const rt = built.value` 是局部变量，不是别名。
        if (ts.isPropertyAccessExpression(init) && ex === "export " && node.parent != null && ts.isSourceFile(node.parent)) {
          const src = oneLine(init.getText(sf));
          const target = init.name.getText(sf);
          const alias = d.name.getText(sf);
          const tag = alias === target ? "[alias 同名转发]" : "[alias 换名 → " + src + "]";
          rows.push([f, at(d), ex + "const " + alias + " = " + src + "   " + tag]);
          continue;
        }
      }
    }
    if (ts.isClassDeclaration(node) && node.name) {
      const clsEx = isExported(node) ? "export " : "";
      for (const m of node.members) {
        if (ts.isMethodDeclaration(m) && m.name) {
          const vis = hasMod(m, ts.SyntaxKind.PrivateKeyword) ? "private " : hasMod(m, ts.SyntaxKind.ProtectedKeyword) ? "protected " : hasMod(m, ts.SyntaxKind.StaticKeyword) ? "static " : "";
          rows.push([f, at(m), clsEx + "class " + node.name.getText(sf) + " → " + vis + m.name.getText(sf) + "(" + m.parameters.map((p) => paramText(p, sf)).join(", ") + ")" + retText(m, sf)]);
        }
        if (ts.isPropertyDeclaration(m) && m.name && m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))) {
          const vis = hasMod(m, ts.SyntaxKind.PrivateKeyword) ? "private " : "";
          rows.push([f, at(m), clsEx + "class " + node.name.getText(sf) + " → " + vis + m.name.getText(sf) + " = (" + m.initializer.parameters.map((p) => paramText(p, sf)).join(", ") + ")" + retText(m.initializer, sf)]);
        }
      }
    }
    ts.forEachChild(node, walk);
  })(sf);
}

const byFile = new Map();
for (const [f, line, sig] of rows) {
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push([line, sig]);
}
const exported = rows.filter(([, , s]) => s.startsWith("export ")).length;
const aliasRows = rows.filter(([, , s]) => s.includes("[alias "));
const renamedAliases = aliasRows.filter(([, , s]) => s.includes("[alias 换名"));
const sameNameAliases = aliasRows.filter(([, , s]) => s.includes("[alias 同名转发"));
// 同一个源被别名多次 = 两个平行名字指向同一实现（最隐蔽的冗余）
const aliasTargets = new Map();
for (const [, , s] of aliasRows) {
  const m = s.match(/\bconst\s+(\w+)\s*=\s*([\w.]+)/);
  if (!m) continue;
  if (!aliasTargets.has(m[2])) aliasTargets.set(m[2], []);
  aliasTargets.get(m[2]).push(m[1]);
}
const multiAliased = [...aliasTargets.entries()].filter(([, names]) => names.length > 1);
const lines = [
  `# 全部函数签名（扫描 ${files.length} 文件 / ${byFile.size} 个含函数 / 共 ${rows.length} 个签名，export ${exported} / 非 export ${rows.length - exported}）`,
  "",
  "## 怎么用这份清单（只看签名，不读实现）",
  "",
  "① 语义重复：同参同返回、或同参数形态的组 → 交 `list-dup-signatures.mjs --all --json` 交叉验证",
  "② OOP 聚合：同一首参反复出现 / createXxxState + 一串 fn(state,…) / clear·reset·ForTests 信号 → 见 SKILL.md §9.4",
  "③ 引用别名：标 `[alias …]` 的行是 `export const X = Y.member` —— 四个 check 脚本都抓不到。",
  "   · `[alias 换名]` = 换了名字的假抽象层，该问「为什么需要这个名字」",
  "   · `[alias 同名转发]` = 纯转发，建议删、调用点改 import 原成员",
  "",
  `## 引用别名汇总（${aliasRows.length} 处：换名 ${renamedAliases.length} / 同名转发 ${sameNameAliases.length}）`,
  "",
];
for (const [src, names] of multiAliased.sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`- ⚠️ \`${src}\` 被别名 ${names.length} 次：${names.join(" / ")}`);
}
if (multiAliased.length === 0) lines.push("- （无同一源被多次别名）");
lines.push("");
for (const [f, list] of [...byFile.entries()].sort()) {
  lines.push(`## ${f}  (${list.length})`);
  for (const [line, sig] of list.sort((a, b) => a[0] - b[0])) lines.push(`  ${String(line).padStart(4)}  ${sig}`);
  lines.push("");
}
mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`全部函数签名 ${rows.length} 个（export ${exported} / 非 export ${rows.length - exported}），${byFile.size} 文件 → ${outPath}`);
