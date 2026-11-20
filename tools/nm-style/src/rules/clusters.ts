/**
 * clusters 规则：p24 主体聚类四视图——worktree scripts/list-subject-clusters.mjs 口径原样迁移。
 * 消费 bare-exports 规则的同一份全域扫描（BareFileEntry），提供四种视图帮分片挑「该收进哪个 namespace」：
 *   ① 同主体族   同目录内 ≥3 个动词操作同一主体（getSession/setSession/deleteSession…）；
 *   ② 修饰词复读 ForTests 后缀 / After<大写> / FromLayout / InTransaction，全仓 ≥3 个函数名才报；
 *   ③ 长名榜     函数名 ≥32 字符，按长度降序（渲染时显示前 40）；
 *   ④ 裸函数榜   按文件聚合裸导出计数降序（渲染时显示前 30）+ 域桶汇总。
 * 基线 gate 并入 `gate bare`（同一 bare-exports-baseline 比对，同源合一，不设独立 gate clusters）。
 * 视图过滤（内置，所有视图一致）：xxxByYyy 查找器、Obj.method 成员形态（防御）；
 * PascalCase 组件 / hooks / keep-bare / test 目录在 bare-exports 扫描层已豁免。
 */

import { summarizeBuckets, type BareFileEntry } from "./bare-exports.js";

// —— 主体词提取 ——————————————————————————————————————————————
// 动词表按长度降序尝试（initialize 先于 init，unregister 先于较短前缀）。
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
const BY_FINDER = /^[a-z]\w*By[A-Z]\w*$/;

/**
 * 名字 → { verb, subject }。两步：先剥已知动词前缀（剩余部分若以介词开头再剥掉），
 * 剥不动时看是不是 `xxxFromYyy` 前置主体形态（主体在前、介词当动词位）。
 */
export function subjectOf(rawName: string): { verb: string; subject: string } | null {
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
export function subjectKey(subject: string): string {
  let w = subject.toLowerCase();
  for (;;) {
    if (/ies$/.test(w) && w.length > 4) { w = w.slice(0, -3) + "y"; continue; }
    if (/(ses|xes|zes|ches|shes)$/.test(w) && w.length > 4) { w = w.slice(0, -2); continue; }
    if (/[^s]s$/.test(w) && w.length > 3) { w = w.slice(0, -1); continue; }
    return w;
  }
}

function viewable(fnName: string): boolean {
  return !BY_FINDER.test(fnName) && !fnName.includes(".");
}

export interface SubjectFamily {
  dir: string;
  subject: string;
  members: Array<{ verb: string; name: string; file: string; line: number }>;
}

/** ① 同主体族：同目录 ≥3 个不同动词操作同一主体，按动词数降序。 */
export function viewSubjectFamilies(entries: readonly BareFileEntry[]): SubjectFamily[] {
  const groups = new Map<string, SubjectFamily>();
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
  return [...groups.values()]
    .filter((g) => new Set(g.members.map((m) => m.verb)).size >= 3)
    .sort((a, b) => new Set(b.members.map((m) => m.verb)).size - new Set(a.members.map((m) => m.verb)).size || a.dir.localeCompare(b.dir));
}

function modifiersOf(name: string): string[] {
  const found: string[] = [];
  if (name.endsWith("ForTests")) found.push("ForTests");
  for (const m of name.matchAll(/After[A-Z]\w*/g)) found.push(m[0]);
  if (name.includes("FromLayout")) found.push("FromLayout");
  if (name.includes("InTransaction")) found.push("InTransaction");
  return found;
}

export type ModifierGroup = [string, Array<{ name: string; file: string; line: number }>];

/** ② 修饰词复读：全仓 ≥3 次才报，按命中次数降序。 */
export function viewModifiers(entries: readonly BareFileEntry[]): ModifierGroup[] {
  const counts = new Map<string, Array<{ name: string; file: string; line: number }>>();
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

/** ③ 长名榜：≥32 字符按长度降序（全量返回，渲染层截前 40）。 */
export function viewLongNames(entries: readonly BareFileEntry[]): Array<{ name: string; file: string; line: number }> {
  return entries
    .flatMap((e) => e.functions.map((fn) => ({ ...fn, file: e.file })))
    .filter((fn) => fn.name.length >= 32 && viewable(fn.name))
    .sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
}

/** ④ 裸函数榜：按文件聚合降序（全量返回，渲染层截前 30）。 */
export function viewByFile(entries: readonly BareFileEntry[]): BareFileEntry[] {
  return [...entries].sort((a, b) => b.functions.length - a.functions.length || a.file.localeCompare(b.file));
}

const LONG_NAME_LIMIT = 40;
const BY_FILE_LIMIT = 30;

/** 四视图文本渲染（旧 printAll 迁移）。 */
export function renderClusters(entries: readonly BareFileEntry[]): string {
  const lines: string[] = [];
  const totalFn = entries.reduce((n, e) => n + e.functions.length, 0);
  lines.push(`扫描 ${entries.length} 个含裸导出文件 / ${totalFn} 个函数（口径同 nm-style bare-exports 全域，test 目录已排除）`);

  const families = viewSubjectFamilies(entries);
  lines.push("", `== ① 同主体族（同目录 ≥3 个动词操作同一主体，共 ${families.length} 族）==`);
  for (const g of families) {
    lines.push("", `[${g.dir}]  ${g.subject} —— ${new Set(g.members.map((m) => m.verb)).size} 动词 / ${g.members.length} 函数`);
    for (const m of [...g.members].sort((a, b) => a.verb.localeCompare(b.verb) || a.name.localeCompare(b.name))) {
      lines.push(`    ${m.verb.padEnd(12)} ${m.name.padEnd(52)} ${m.file}:${m.line}`);
    }
  }
  if (families.length === 0) lines.push("  （无）");

  const mods = viewModifiers(entries);
  lines.push("", `== ② 修饰词复读（全仓 ≥3 次才报，命中 ${mods.length} 种）==`);
  for (const [mod, sites] of mods) {
    lines.push("", `  ${mod} ×${sites.length}`);
    for (const s of sites) lines.push(`    ${s.name.padEnd(52)} ${s.file}:${s.line}`);
  }
  if (mods.length === 0) lines.push("  （无）");

  const longs = viewLongNames(entries);
  lines.push("", `== ③ 长名榜（≥32 字符，共 ${longs.length} 个${longs.length > LONG_NAME_LIMIT ? "，显示前 40" : ""}）==`);
  for (const fn of longs.slice(0, LONG_NAME_LIMIT)) lines.push(`    ${String(fn.name.length).padStart(3)}  ${fn.name}  ${fn.file}:${fn.line}`);
  if (longs.length === 0) lines.push("  （无）");

  const byFile = viewByFile(entries);
  lines.push("", `== ④ 裸函数榜（按文件聚合降序，共 ${byFile.length} 文件，显示前 30）==`);
  for (const e of byFile.slice(0, BY_FILE_LIMIT)) lines.push(`    ${String(e.functions.length).padStart(3)}  ${e.file}`);
  lines.push("", "  域桶汇总（按函数数降序）：");
  const buckets = [...summarizeBuckets(entries).entries()].sort((a, b) => b[1].functions - a[1].functions || a[0].localeCompare(b[0]));
  for (const [name, b] of buckets) lines.push(`    ${name.padEnd(38)} ${String(b.files).padStart(5)} ${String(b.functions).padStart(5)}`);
  return lines.join("\n");
}
