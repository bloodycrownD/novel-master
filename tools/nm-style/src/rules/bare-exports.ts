/**
 * bare-exports 规则：顶层裸 export function 门禁（p24 收编对象，verdict=BARE_EXPORT）。
 * 正则与豁免链从 check-style.mjs bare-exports 段原样迁移：.tsx PascalCase 组件豁免、use* 钩子豁免、
 * keep-bare 注释须在 export 行前 3 行内（行扫描器语义，不用 directives.ts 的无界 trivia 上溯）、
 * HEAD 同名导出兜底（HEAD 已有的名不算新增，防跨 hunk 移动/行尾重写误报）。
 * 全域口径以 worktree scripts/list-bare-exports.mjs（基线生成器）为权威（spec §3.5.3）：
 *   扫描域 = git ls-files packages apps（含 --others 未跟踪）∩ packages/<包>/src +
 *   apps/(desktop|mobile)/src，排除 apps/cli（域正则天然不含）、.d.ts、dist/node_modules 与
 *   test 目录（--include-tests 才收）；同名重载去重保留首行。
 * 豁免唯一通道是源码内 `nm-style: keep-bare` 注释——不吃 KFP/suppress（spec §3.3），gate 新增即红。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toPosix } from "../lib/core.js";
import { BARE_EXPORT_FN, gitLines, headExportFnNames, type AddedLinePredicate } from "../lib/git.js";
import type { Finding } from "../lib/report.js";
import type { ScanEntry } from "./signatures.js";

const KEEP_BARE_MARK = "nm-style: keep-bare";
/** 顶层裸 export function 必须直接进 namespace；确需裸导出加 nm-style: keep-bare 注释。 */
const BARE_EXPORT_DETAIL = "p24 期间新增顶层 export function 必须直接进 namespace；确需裸导出加 nm-style: keep-bare 注释";

/** bare-exports 全域：packages/<包>/src 与 apps/(desktop|mobile)/src 下的 .ts/.tsx（排除 .d.ts、dist、node_modules）；apps/cli 不在域内。 */
export function isInBareDomain(rel: string): boolean {
  const posix = toPosix(rel);
  if (!(posix.endsWith(".ts") || posix.endsWith(".tsx")) || posix.endsWith(".d.ts")) return false;
  if (!/^packages\/[^/]+\/src\//.test(posix) && !/^apps\/(desktop|mobile)\/src\//.test(posix)) return false;
  const segs = posix.split("/");
  return !segs.includes("dist") && !segs.includes("node_modules");
}

/** 全域文件清单（posix 相对路径，排序）：git 已跟踪 + 未跟踪（gate 必须能看到还没 add 的新文件）。 */
export function bareDomainFiles(includeTests = false): string[] {
  return [...gitLines("git ls-files packages apps"), ...gitLines("git ls-files --others --exclude-standard packages apps")]
    .filter((rel) => (rel.endsWith(".ts") || rel.endsWith(".tsx")) && !rel.endsWith(".d.ts"))
    .filter(isInBareDomain)
    .filter((rel) => {
      const segs = rel.split("/");
      return includeTests || (!segs.includes("test") && !segs.includes("__tests__"));
    })
    .sort();
}

export interface BareFunction {
  name: string;
  line: number;
}

/**
 * 单文件内的裸顶层 export function（[{name, line}]，同名重载去重保留首行）。
 * 豁免链与 worktree 基线生成器一致：hooks / .tsx PascalCase 组件 / 前 3 行内的 nm-style: keep-bare 注释。
 */
export function bareExportsOf(text: string, isTsx: boolean): BareFunction[] {
  const lines = text.split(/\r?\n/);
  const found: BareFunction[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = BARE_EXPORT_FN.exec(lines[i]);
    if (match == null) continue;
    const name = match[1];
    if (isTsx && /^[A-Z]/.test(name)) continue; // .tsx PascalCase = React 组件
    if (/^use[A-Z0-9_]/.test(name) || name === "use") continue; // React hooks
    if (lines.slice(Math.max(0, i - 3), i).join("\n").includes(KEEP_BARE_MARK)) continue;
    if (found.some((fn) => fn.name === name)) continue; // 重载签名只计一次（保留首个行号）
    found.push({ name, line: i + 1 });
  }
  return found;
}

export interface BareFileEntry {
  /** 仓根相对 posix 路径。 */
  file: string;
  bucket: string;
  functions: BareFunction[];
}

/** 域桶规则：与 worktree list-bare-exports.mjs bucketOf 逐字对齐。 */
export function bucketOf(rel: string): string {
  let m = /^packages\/core\/src\/(.+)$/.exec(rel);
  if (m) {
    const seg = m[1].split("/");
    return ["domain", "service", "infra", "presentation"].includes(seg[0]) && seg[1] ? `core/${seg[0]}/${seg[1]}` : `core/${seg[0]}`;
  }
  m = /^apps\/(mobile|desktop)\/(.+)$/.exec(rel);
  if (m) {
    const seg = m[2].split("/");
    return seg[0] === "src" && seg[1] ? `${m[1]}/src/${seg[1]}` : `${m[1]}/${seg[0]}`;
  }
  m = /^packages\/([^/]+)\//.exec(rel);
  return m ? `packages/${m[1]}` : "other";
}

/** 全域扫描：每文件一条（functions 按行序），无裸导出的文件不出现。 */
export function scanBareDomainFiles(includeTests = false): BareFileEntry[] {
  const entries: BareFileEntry[] = [];
  for (const rel of bareDomainFiles(includeTests)) {
    let text: string;
    try {
      text = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
    } catch {
      continue; // 未跟踪又已删除的暂存文件等
    }
    const functions = bareExportsOf(text, rel.endsWith(".tsx"));
    if (functions.length === 0) continue;
    entries.push({ file: rel, bucket: bucketOf(rel), functions });
  }
  return entries;
}

export interface BucketCount {
  files: number;
  functions: number;
}

/** 域桶计数（与 summarizeBuckets 同口径）。 */
export function summarizeBuckets(files: readonly BareFileEntry[]): Map<string, BucketCount> {
  const buckets = new Map<string, BucketCount>();
  for (const f of files) {
    const b = buckets.get(f.bucket) ?? { files: 0, functions: 0 };
    buckets.set(f.bucket, { files: b.files + 1, functions: b.functions + f.functions.length });
  }
  return buckets;
}

/** 基线生成用 files map：file → 排序后的去重函数名（键值双排序，与 worktree 基线生成器逐字段一致）。 */
export function bareFilesMap(includeTests = false): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const entry of scanBareDomainFiles(includeTests)) map[entry.file] = [...new Set(entry.functions.map((fn) => fn.name))].sort();
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
}

export interface BareGateResult {
  baseFileCount: number;
  curFileCount: number;
  addedFiles: Array<{ file: string; names: string[] }>;
  addedNames: Array<{ file: string; names: string[] }>;
  /** 改善计数：基线里有而当前消失的文件数（文件整个消失或丢函数名都算）。 */
  removedCount: number;
}

/** gate bare 比对（判据=worktree clusters gate）：新增文件条目或既有文件新增函数名；减少是改善，不阻断。 */
export function bareGateCompare(baselineFiles: Record<string, string[]> | undefined, current: Record<string, string[]>): BareGateResult {
  const base = new Map(Object.entries(baselineFiles ?? {}).map(([file, names]) => [file, new Set(names)]));
  const cur = new Map(Object.entries(current).map(([file, names]) => [file, new Set(names)]));
  const addedFiles = [...cur.keys()].filter((file) => !base.has(file)).map((file) => ({ file, names: [...cur.get(file)!] }));
  const addedNames = [...cur.keys()]
    .filter((file) => base.has(file) && [...cur.get(file)!].some((name) => !base.get(file)!.has(name)))
    .map((file) => ({ file, names: [...cur.get(file)!].filter((name) => !base.get(file)!.has(name)) }));
  const removedCount = [...base.keys()].filter((file) => !cur.has(file) || [...base.get(file)!].some((name) => !cur.get(file)!.has(name))).length;
  return { baseFileCount: base.size, curFileCount: cur.size, addedFiles, addedNames, removedCount };
}

export interface BareExportsContext {
  /** 待扫条目（file 仓根相对 posix 或绝对；text null=读盘，非 null=blob 直解析）。 */
  entries: readonly ScanEntry[];
  /** true = --changed 阻断口径（新增行过滤 + HEAD 同名兜底）；false = INFO 计数。 */
  changed: boolean;
  isAdded: AddedLinePredicate;
}

/** check 的 bare-exports 段：changed 阻断（blocking）/ 计数（非阻断），行项即 BARE_EXPORT finding。 */
export function scanBareExports(ctx: BareExportsContext): Finding[] {
  const findings: Finding[] = [];
  const headCache = new Map<string, Set<string> | null>();
  const headNamesOf = (rel: string): Set<string> | null => {
    if (!headCache.has(rel)) headCache.set(rel, headExportFnNames(rel));
    return headCache.get(rel)!;
  };
  for (const entry of ctx.entries) {
    const rel = toPosix(entry.file);
    const text = entry.text ?? readDisk(entry.file);
    if (text == null) continue;
    for (const fn of bareExportsOf(text, rel.endsWith(".tsx"))) {
      if (ctx.changed) {
        if (!ctx.isAdded(rel, fn.line)) continue;
        const head = headNamesOf(rel);
        if (head != null && head.has(fn.name)) continue;
      }
      findings.push({ rule: "bare-exports", file: rel, line: fn.line, symbol: fn.name, verdict: "BARE_EXPORT", detail: BARE_EXPORT_DETAIL, blocking: ctx.changed });
    }
  }
  return findings;
}

function readDisk(file: string): string | null {
  try {
    return fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
  } catch {
    return null;
  }
}

/** 工具版本（baseline v2 的 toolVersion 字段）：按包根定位 package.json，读不到给 unknown。 */
export function toolVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}
