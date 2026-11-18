#!/usr/bin/env node
/**
 * p24 主体聚类视图 + 裸导出增量门禁（subject-cluster-oop 波 0 检测器之二）。
 *
 * 消费 list-bare-exports.mjs 的同一份扫描（口径共享，保证与 --json / 基线一致），
 * 在裸顶层 export function 清单上给四种视图，帮 p24 分片时挑「该收进哪个 namespace」：
 *
 *   ① 同主体族   同目录内 ≥3 个动词操作同一主体（getSession/setSession/deleteSession…）
 *                主体词 = 去动词前缀后的 PascalCase 段；xxxFromYyy / xxxToYyy 这类
 *                前置主体也算（createXxx+parseXxx+xxxFromYyy 同族）。
 *   ② 修饰词复读  ForTests 后缀 / After&lt;大写&gt; / FromLayout / InTransaction，
 *                全仓口径，同一修饰词 ≥3 个函数名才报。
 *   ③ 长名榜     函数名 ≥32 字符，按长度降序——上下文全塞进函数名的典型。
 *   ④ 裸函数榜   按文件聚合裸导出计数（降序）+ 域桶汇总，与 list-bare-exports 对齐。
 *
 * 用法：
 *   node scripts/list-subject-clusters.mjs <repo> --all              # 四种视图
 *   node scripts/list-subject-clusters.mjs <repo> --gate             # 与基线比对：新增裸导出 exit 1
 *   node scripts/list-subject-clusters.mjs <repo> --update-baseline  # 重建基线（改善后收紧门槛）
 *   （均可加 --include-tests，默认排除 test/、__tests__/）
 *
 * 视图过滤（内置，所有视图一致）：PascalCase 组件（.tsx）、use 开头 hooks、
 * [a-z]xxxBy[A-Z]xxx 查找器、Obj.method 成员形态（行首正则本就扫不到，防御）、
 * keep-bare 标注、test 目录。前三条里前两条与 keep-bare 在扫描层已豁免，
 * 查找器与成员形态在这里再挡一层。
 *
 * --gate 判据：当前扫描的「文件 → 函数名集合」与 scripts/bare-exports-baseline.json
 * 比对，新增文件条目或既有文件新增函数名 → exit 1 并列出；减少是改善，不阻断。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { scanBareExports, summarizeBuckets } from "./list-bare-exports.mjs";

const BASELINE = new URL("./bare-exports-baseline.json", import.meta.url);
const BY_FINDER = /^[a-z]\w*By[A-Z]\w*$/;

// —— 主体词提取 ——————————————————————————————————————————————
// 动词表按长度降序尝试（initialize 先于 init，unregister 先于 shorter 前缀）。
const VERBS = [...new Set([
  "apply", "assert", "attach", "build", "check", "clamp", "clear", "collapse", "collect", "compare", "compile", "compute", "convert", "copy",
  "count", "create", "decode", "decompress", "dedupe", "delete", "describe", "deserialize", "detect", "diff", "dispatch", "drop", "dump",
  "encode", "ensure", "escape", "execute", "expand", "expose", "extract", "feed", "fetch", "fill", "filter", "find", "finish", "flush",
  "fold", "format", "from", "freeze", "generate", "get", "group", "guard", "has", "hash", "hydrate", "index", "init", "initialize",
  "insert", "intersect", "invalidate", "is", "iterate", "join", "keep", "label", "list", "load", "lock", "lookup", "make", "map", "mark",
  "match", "merge", "migrate", "move", "normalize", "note", "open", "pack", "parse", "pick", "plan", "prepare", "pretty", "prune",
  "query", "read", "rebuild", "register", "rehydrate", "remember", "remove", "rename", "render", "reorder", "replace", "report",
  "request", "reset", "resolve", "restore", "sanitize", "save", "scan", "schedule", "seal", "seek", "seed", "select", "send",
  "serialize", "set", "should", "shuffle", "split", "squash", "start", "stop", "strip", "sweep", "sync", "take", "teardown", "test",
  "to", "track", "transform", "translate", "trim", "truncate", "try", "unfold", "unregister", "unpack", "unwrap", "update", "upgrade",
  "upload", "validate", "verify", "wait", "walk", "watch", "wrap", "write",
])].sort((a, b) => b.length - a.length);
const PREPOSITION = "From|To|For|By|With|In|At|On|After|Into";
const PREPOSITION_HEAD = new RegExp(`^(${PREPOSITION})([A-Z_].+)$`);

/**
 * 名字 → { verb, subject }。两步：先剥已知动词前缀（剩余部分若以介词开头再剥掉），
 * 剥不动时看是不是 `xxxFromYyy` 前置主体形态（主体在前、介词当动词位）。
 */
export function subjectOf(rawName) {
  const name = rawName.replace(/^_+/, "");
  if (!/^[a-z]/.test(name)) return null;
  for (const verb of VERBS) {
    if (name.length > verb.length && name.startsWith(verb) && /[A-Z_]/.test(name[verb.length])) {
      const rest = name.slice(verb.length).replace(/ForTests$/, "");
      return { verb, subject: rest.replace(PREPOSITION_HEAD, "$2") };
    }
  }
  const m = new RegExp(`^([a-z][a-z0-9]*)(${PREPOSITION})([A-Z_].*)?$`).exec(name.replace(/ForTests$/, ""));
  if (m) return { verb: m[2].toLowerCase(), subject: m[1][0].toUpperCase() + m[1].slice(1) };
  return null;
}

/** 主体分组键：小写 + 去复数（session/sessions、status/statuses 归并；启发式，只用于聚类）。 */
export function subjectKey(subject) {
  let w = subject.toLowerCase();
  for (;;) {
    if (/ies$/.test(w) && w.length > 4) { w = w.slice(0, -3) + "y"; continue; }
    if (/(ses|xes|zes|ches|shes)$/.test(w) && w.length > 4) { w = w.slice(0, -2); continue; }
    if (/[^s]s$/.test(w) && w.length > 3) { w = w.slice(0, -1); continue; }
    return w;
  }
}

// —— 视图 ——————————————————————————————————————————————————————
function viewable(fnName) {
  return !BY_FINDER.test(fnName) && !fnName.includes(".");
}

function viewSubjectFamilies(entries) {
  const groups = new Map();
  for (const { file, functions } of entries) {
    const dir = file.split("/").slice(0, -1).join("/");
    for (const fn of functions) {
      if (!viewable(fn.name)) continue;
      const s = subjectOf(fn.name);
      if (s == null) continue;
      const key = `${dir}\t${subjectKey(s.subject)}`;
      const g = groups.get(key) ?? { dir, subject: s.subject, members: [] };
      g.members.push({ ...s, name: fn.name, file, line: fn.line });
      groups.set(key, g);
    }
  }
  return [...groups.values()].filter((g) => new Set(g.members.map((m) => m.verb)).size >= 3)
    .sort((a, b) => new Set(b.members.map((m) => m.verb)).size - new Set(a.members.map((m) => m.verb)).size || a.dir.localeCompare(b.dir));
}

function modifiersOf(name) {
  const found = [];
  if (name.endsWith("ForTests")) found.push("ForTests");
  for (const m of name.matchAll(/After[A-Z]\w*/g)) found.push(m[0]);
  if (name.includes("FromLayout")) found.push("FromLayout");
  if (name.includes("InTransaction")) found.push("InTransaction");
  return found;
}

function viewModifiers(entries) {
  const counts = new Map();
  for (const { file, functions } of entries) {
    for (const fn of functions) {
      if (!viewable(fn.name)) continue;
      for (const mod of modifiersOf(fn.name)) {
        const c = counts.get(mod) ?? [];
        c.push({ name: fn.name, file, line: fn.line });
        counts.set(mod, c);
      }
    }
  }
  return [...counts.entries()].filter(([, sites]) => sites.length >= 3).sort((a, b) => b[1].length - a[1].length);
}

function printAll(entries) {
  const totalFn = entries.reduce((n, e) => n + e.functions.length, 0);
  console.log(`扫描 ${entries.length} 个含裸导出文件 / ${totalFn} 个函数（口径同 list-bare-exports.mjs，test 目录已排除）`);

  const families = viewSubjectFamilies(entries);
  console.log(`\n== ① 同主体族（同目录 ≥3 个动词操作同一主体，共 ${families.length} 族）==`);
  for (const g of families) {
    console.log(`\n[${g.dir}]  ${g.subject} —— ${new Set(g.members.map((m) => m.verb)).size} 动词 / ${g.members.length} 函数`);
    for (const m of g.members.sort((a, b) => a.verb.localeCompare(b.verb) || a.name.localeCompare(b.name))) {
      console.log(`    ${m.verb.padEnd(12)} ${m.name.padEnd(52)} ${m.file}:${m.line}`);
    }
  }
  if (families.length === 0) console.log("  （无）");

  const mods = viewModifiers(entries);
  console.log(`\n== ② 修饰词复读（全仓 ≥3 次才报，命中 ${mods.length} 种）==`);
  for (const [mod, sites] of mods) {
    console.log(`\n  ${mod} ×${sites.length}`);
    for (const s of sites) console.log(`    ${s.name.padEnd(52)} ${s.file}:${s.line}`);
  }
  if (mods.length === 0) console.log("  （无）");

  const longs = entries.flatMap((e) => e.functions.map((fn) => ({ ...fn, file: e.file }))).filter((fn) => fn.name.length >= 32 && viewable(fn.name))
    .sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
  console.log(`\n== ③ 长名榜（≥32 字符，共 ${longs.length} 个${longs.length > 40 ? "，显示前 40" : ""}）==`);
  for (const fn of longs.slice(0, 40)) console.log(`    ${String(fn.name.length).padStart(3)}  ${fn.name}  ${fn.file}:${fn.line}`);
  if (longs.length === 0) console.log("  （无）");

  const byFile = [...entries].sort((a, b) => b.functions.length - a.functions.length || a.file.localeCompare(b.file));
  console.log(`\n== ④ 裸函数榜（按文件聚合降序，共 ${byFile.length} 文件，显示前 30）==`);
  for (const e of byFile.slice(0, 30)) console.log(`    ${String(e.functions.length).padStart(3)}  ${e.file}`);
  console.log(`\n  域桶汇总（按函数数降序）：`);
  const buckets = [...summarizeBuckets(entries).entries()].sort((a, b) => b[1].functions - a[1].functions || a[0].localeCompare(b[0]));
  for (const [name, b] of buckets) console.log(`    ${name.padEnd(38)} ${String(b.files).padStart(5)} ${String(b.functions).padStart(5)}`);
}

// —— gate / baseline ———————————————————————————————————————————
function currentSets(entries) {
  return new Map(entries.map((e) => [e.file, new Set(e.functions.map((fn) => fn.name))]));
}

function updateBaseline(entries, includeTests) {
  const files = Object.fromEntries([...currentSets(entries).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([f, names]) => [f, [...names].sort()]));
  const payload = { note: "p24 裸导出基线（p23 后）。--gate 判据：新增文件条目或既有文件新增函数名 → exit 1；减少是改善，不阻断。重建：node scripts/list-subject-clusters.mjs <repo> --update-baseline", generatedAt: new Date().toISOString(), includeTests, files };
  writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`已写基线：${Object.keys(files).length} 文件 / ${Object.values(files).reduce((n, v) => n + v.length, 0)} 函数 → ${BASELINE.pathname}`);
}

function gate(entries, includeTests) {
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  } catch {
    console.error("bare-exports: 基线不存在或损坏：" + BASELINE.pathname + "。先跑 --update-baseline。");
    process.exit(2);
  }
  if (baseline.includeTests !== includeTests) console.error(`bare-exports: 注意——基线 includeTests=${baseline.includeTests}，本次 includeTests=${includeTests}，口径不一致`);
  const base = new Map(Object.entries(baseline.files ?? {}).map(([f, names]) => [f, new Set(names)]));
  const cur = currentSets(entries);
  const addedFiles = [...cur.keys()].filter((f) => !base.has(f));
  const addedNames = [...cur.keys()].filter((f) => base.has(f) && [...cur.get(f)].some((n) => !base.get(f).has(n)))
    .map((f) => [f, [...cur.get(f)].filter((n) => !base.get(f).has(n))]);
  const removed = [...base.keys()].filter((f) => !cur.has(f) || [...base.get(f)].some((n) => !cur.get(f).has(n))).length;
  console.log(`bare-exports: 基线 ${base.size} 文件 → 当前 ${cur.size} 文件（新增文件 ${addedFiles.length} / 新增函数 ${addedNames.reduce((n, [, v]) => n + v.length, 0)} / 改善 ${removed}）`);
  if (addedFiles.length) {
    console.log("\n[新增裸导出文件]");
    for (const f of addedFiles) console.log(`  ${f}: ${[...cur.get(f)].join(", ")}`);
  }
  if (addedNames.length) {
    console.log("\n[既有文件新增裸导出]");
    for (const [f, names] of addedNames) console.log(`  ${f}: +${names.join(", +")}`);
  }
  const bad = addedFiles.length + addedNames.length;
  console.log(`\nbare-exports: ${bad === 0 ? "PASS（无新增裸导出）" : `FIND（新增 ${bad} 处，p24 期间新顶层 export function 必须直接进 namespace；确需裸导出加 nm-style: keep-bare 注释）`}`);
  process.exit(bad === 0 ? 0 : 1);
}

// —— CLI ———————————————————————————————————————————————————————
const argv = process.argv.slice(2);
const root = argv.find((a) => !a.startsWith("--"));
const modes = argv.filter((a) => ["--all", "--gate", "--update-baseline"].includes(a));
if (root == null || modes.length !== 1) {
  console.error("用法: node scripts/list-subject-clusters.mjs <repo> --all | --gate | --update-baseline [--include-tests]");
  process.exit(2);
}
const includeTests = argv.includes("--include-tests");
const entries = scanBareExports(root, { includeTests });
if (modes[0] === "--update-baseline") updateBaseline(entries, includeTests);
else if (modes[0] === "--gate") gate(entries, includeTests);
else printAll(entries);
