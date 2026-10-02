#!/usr/bin/env node
/**
 * check-encoding · 钩子①（wave-e H1）
 *
 * 扫描面（实测口径，落地于 2026-10-01）：
 *   - 只看 git 跟踪文件（`git ls-files -z`），拿不到清单时回落全量遍历并 warn；
 *   - 后缀白名单：.ts .tsx .js .mjs .json .md .yml .yaml .kt .java .gradle
 *   - 排除目录：node_modules/ dist/ webview-dist/ coverage/ .git/ build/
 *     ⚠️ `android/` **不在**排除目录里（CR-F15）：原先「路径任意分段等于 android 就整棵
 *     子树跳过」，把真机运行的应用源码 `MainActivity.kt` / `MainApplication.kt` 一起排掉了，
 *     而 `.kt` / `.java` / `.gradle` 三个后缀在 SCAN_EXTENSIONS 里就成了摆设
 *     （全仓 `.kt` 只存在于 android/ 树下 ⇒ 那三个后缀扫不到任何真机源码）。
 *     真正要排的只有 `apps/mobile/android/app/build.gradle` 这**一个文件**（见下方排除面）。
 *   - ⚠️ **显式排除面（文件级，路径前缀，仓根相对正斜杠）**：
 *     ① `docs/Iterations/`（迭代过程文档面）。实测该目录下另有 3 个 BOM +
 *     1 个含 U+FFFD 的文件（其中 1 个同时是非法 UTF-8），它们属迭代留痕文档、不算源码错误；
 *     但必须**显式声明**在这里，否则读者会以为门禁覆盖了全仓所有文本。
 *     该目录实测 779 个文件、占扫描面 22%；那里的编码损坏是**记录**而不是**病症**。
 *     其余 `docs/`（如 `docs/apm/`、包级 `packages/xxx/docs/`）**仍在扫描面内**。
 *     ② `apps/mobile/android/app/build.gradle`：GBK 混编，20 处 U+FFFD 且 TextDecoder(fatal)
 *     判非合法 UTF-8，RULE:113 已单列为 Wave A 的另一条修复线，本门禁不接管。
 *     ⚠️ 收窄成文件级之前必须实跑确认 android 树下命中真的只有它一个——实测（2026-10-02 复核）：
 *     android 树里后缀命中白名单的文件共 **32** 个，其中 31 个进扫描面（apps/mobile 4 /
 *     llm-sse-native 3 / sksp-android 3 / tokenizer-driver-rn 21），第 32 个就是被文件级前缀
 *     排除的 build.gradle。进面的 31 个全部干净（.kt 15 / .gradle 5 / .json 9 / .md 2），
 *     仓内 android 树的命中仍然只有 build.gradle 那 20 处 U+FFFD，且它已被排除 ⇒ 全仓 0/0/0。
 *
 * 两类命中，必须分开报：
 *   - `bom`  ：前三字节 EF BB BF（合法 UTF-8 前的 BOM，工具链会当首行内容处理）；
 *   - `fffd` ：UTF-8 **合法**但内容里真含 U+FFFD 码点 ⇒ 源码被写坏过，本条要治的正是它；
 *   - `bad-utf8`：字节层就不是合法 UTF-8（解码产 replacement char，但文件里根本没有
 *     U+FFFD 这个码点）⇒ 坏的是**原始字节**，不能逐字符替换，须从父提交整体还原
 *     （wave-e H1.3 Step 4 的 B 类，MF-9）。这一类与 `fffd` 分开报，避免误用 A 类修法。
 *
 * 用法：
 *   node scripts/check-encoding.mjs            # 全量扫描
 *   node scripts/check-encoding.mjs --staged   # 只扫 git 暂存区（pre-commit 用）
 *   node scripts/check-encoding.mjs --baseline # 打印各 workspace 的命中计数（建基线用）
 *
 * ⚠️ `--staged` 模式读的是**暂存区 blob**（`git show :<rel>`，按 Buffer 读），不是工作区
 *   文件内容。读工作区会让「先 `git add` 脏版本 → 再把工作区擦干净 → 提交」这条普通工作流
 *   直接绕过钩子，而进历史的正是那份脏 blob（CR-F14 实测：旧实现 exit 0 放行）。
 *
 * 退出码：命中即 1（门禁语义）。`--baseline` 恒 0。
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

const SCAN_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".kt", ".java", ".gradle",
]);
const SKIP_DIRECTORIES = new Set([
  "node_modules", "dist", "webview-dist", "coverage", ".git", "build",
]);
/** 显式排除面（文件级，路径前缀，仓根相对、正斜杠）：见文件头「显式排除面」声明。 */
const SKIP_PATH_PREFIXES = ["docs/Iterations/", "apps/mobile/android/app/build.gradle"];
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const FFFD = "\uFFFD";

const args = process.argv.slice(2);
const onlyStaged = args.includes("--staged");
const baselineMode = args.includes("--baseline");

/** @type {{ bom: string[], fffd: string[], badUtf8: string[] }} */
const findings = { bom: [], fffd: [], badUtf8: [] };

const files = onlyStaged ? listStagedFiles() : listTrackedFiles();

for (const file of files) {
  const rel = file.rel;
  if (!SCAN_EXTENSIONS.has(path.extname(rel))) continue;
  if (SKIP_PATH_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
  if (rel.split("/").some((segment) => SKIP_DIRECTORIES.has(segment))) continue;

  let buffer;
  try {
    // 暂存区模式下 content 已在 listStagedFiles 里从 `git show :<rel>` 读成 Buffer；
    // 全量模式下 content 为 null，才回落读工作区文件。
    buffer = file.content ?? readFileSync(path.join(repoRoot, rel));
  } catch {
    continue;
  }
  if (buffer.length === 0) continue;

  if (buffer.length >= 3 && buffer[0] === BOM[0] && buffer[1] === BOM[1] && buffer[2] === BOM[2]) {
    findings.bom.push(rel);
  }

  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const replacementCount = countOccurrences(decoded, FFFD);
  if (replacementCount > 0) findings.fffd.push(`${rel} (${replacementCount})`);

  if (isValidUtf8(buffer)) continue;
  // 非法 UTF-8：文件里没有 U+FFFD 码点，坏的是字节。上面若同时报了 fffd，
  // 说明解码产生的 replacement 与真码点混在一起了 —— 仍按 bad-utf8 归类。
  findings.badUtf8.push(rel);
}

if (baselineMode) {
  printBaseline();
  process.exit(0);
}

printFindings();
process.exit(
  findings.bom.length + findings.fffd.length + findings.badUtf8.length > 0 ? 1 : 0,
);

/**
 * 扫描目标：暂存区模式带 content（index blob 的 Buffer），全量模式 content 为 null 走工作区。
 * @typedef {{ rel: string, content: Buffer | null }} ScanTarget
 */

/** 全量模式：只列路径（`content: null`），真正读字节留到主循环按需 readFileSync。 */
function listTrackedFiles() {
  const listed = tryGit(["ls-files", "-z"]);
  if (listed !== null) {
    return listed.split("\0").filter(Boolean).map((rel) => ({ rel, content: null }));
  }
  console.warn("[check-encoding] `git ls-files` 不可用，回落全量遍历（会包含未跟踪文件）。");
  return walk(repoRoot).map((file) => ({
    rel: path.relative(repoRoot, file).split(path.sep).join("/"),
    content: null,
  }));
}

/**
 * 暂存区模式：文件名取自 `git diff --cached --name-only --diff-filter=ACM`，
 * **字节取自 `git show :<rel>`（index 里的 blob）**——不是工作区文件（CR-F14）。
 *
 * ⚠️ 读工作区正是被绕过的那个面：「暂存脏版 → 工作区擦净 → 提交」会绿着过，而 commit 里
 * 躺着脏 blob。`--diff-filter=ACM` 已排掉删除态，所以每个 rel 都有 `:rel` 可读；读不到就
 * 响亮失败，**不回落工作区**（回落等于把病请回来）。
 */
function listStagedFiles() {
  const listed = tryGit(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACM"]);
  if (listed === null) {
    console.error("[check-encoding] `git diff --cached` 不可用，无法扫描暂存区。");
    process.exit(1);
  }
  /** @type {ScanTarget[]} */
  const out = [];
  for (const rel of listed.split("\0").filter(Boolean)) {
    // 不带 encoding 即返回 Buffer：含非 UTF-8 字节的 blob 也能原样拿到（解码在后面统一做）。
    const content = tryGit(["show", `:${rel}`], { raw: true });
    if (content === null) {
      console.error(`[check-encoding] 读暂存区 blob 失败：${rel}（不回落工作区，见文件头 CR-F14 注记）。`);
      process.exit(1);
    }
    out.push({ rel, content });
  }
  return out;
}

/**
 * @param {string[]} gitArgs
 * @param {{ raw?: boolean }} [options] `raw: true` 返回 Buffer 而不是 utf8 字符串。
 * @returns {string | Buffer | null}
 */
function tryGit(gitArgs, options = {}) {
  try {
    return execFileSync("git", gitArgs, {
      cwd: repoRoot,
      encoding: options.raw ? undefined : "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function walk(dir) {
  const out = [];
  for (const name of readdirSafe(dir)) {
    const full = path.join(dir, name);
    if (SKIP_DIRECTORIES.has(name)) continue;
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) out.push(...walk(full));
    else if (stats.isFile()) out.push(full);
  }
  return out;
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isValidUtf8(buffer) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function printFindings() {
  const total = findings.bom.length + findings.fffd.length + findings.badUtf8.length;
  const scopeNote = onlyStaged ? "暂存区 blob（git show :<path>）" : "跟踪文件";
  if (total === 0) {
    console.log(`[check-encoding] OK：扫描 ${files.length} 个${scopeNote}，0 命中。`);
    return;
  }
  console.error(`[check-encoding] 命中 ${total} 处（扫描面：git ${scopeNote}，排除 node_modules/dist/webview-dist/build/docs-Iterations/apps-mobile-android-app-build.gradle）`);
  printGroup("BOM（UTF-8 BOM 前缀，合法编码，仅工具链风险）", findings.bom);
  printGroup("U+FFFD（合法 UTF-8 内嵌真替换字符 ⇒ 源码被写坏；须逐字符替换）", findings.fffd);
  printGroup(
    "非 UTF-8（字节层非法，文件里没有 U+FFFD 码点 ⇒ 坏的是字节；须从父提交整体还原）",
    findings.badUtf8,
  );
  console.error("[check-encoding] 口径见 wave-e H1.3 Step 4：A 类（fffd）走字节级安全替换，B 类（bad-utf8）走 `git checkout <父提交> -- <路径>`。");
}

function printGroup(title, items) {
  if (items.length === 0) return;
  console.error(`\n  · ${title} —— ${items.length}`);
  for (const item of items) console.error(`      ${item}`);
}

function printBaseline() {
  const buckets = new Map();
  const bump = (kind, rel) => {
    const key = kind === "bom" ? "BOM" : kind === "fffd" ? "U+FFFD" : "非 UTF-8";
    const scope = rel.split("/").slice(0, 2).join("/");
    const bucketKey = `${scope} | ${key}`;
    buckets.set(bucketKey, (buckets.get(bucketKey) ?? 0) + 1);
  };
  for (const rel of findings.bom) bump("bom", rel);
  for (const entry of findings.fffd) bump("fffd", entry.split(" (")[0]);
  for (const rel of findings.badUtf8) bump("badUtf8", rel);
  console.log(`[check-encoding] baseline：扫描 ${files.length} 个文件`);
  for (const [key, count] of [...buckets].sort()) console.log(`  ${key} = ${count}`);
  console.log(
    `[check-encoding] 合计 bom=${findings.bom.length} fffd=${findings.fffd.length} badUtf8=${findings.badUtf8.length}`,
  );
}