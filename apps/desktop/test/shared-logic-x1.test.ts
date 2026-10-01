/**
 * X1 结构快照：renderer 侧零直连 `@novel-master/core`（wave-e X1.5）。
 *
 * 定位：**eslint 未安装 / 未跑的环境下的兜底**。X1 的主门禁是 eslint 的
 * `no-restricted-imports`，它要起 eslint 进程、要解析 tsconfig；本条不依赖任何外部工具，
 * 只用 Node 内置 fs 做静态扫描，所以「本地没装 eslint / CI 那一步被跳过」时这条仍然有牙。
 *
 * 对账口径（spec X1.5）：把「`shared/logic/*.ts` 里出现的每一个 core 符号」与
 * 「`renderer/**` 实际 import 的 core 符号」做集合对账，断言 **renderer 侧集合为空**。
 *
 * ⚠️ **防「恒真」**：只断言 renderer 侧为空是不够的——若 `shared/logic` 那一侧也被清空，
 * 对账就退化成「空 ⊆ 空」，永远绿。故另有一条用例钉住对账面非空
 * （见「shared/logic 再导出面非空」）。
 *
 * ⚠️ 扫描必须**先剥注释**：`shared/logic/encoding.ts` 这类文件的文件头注释里就写着
 * `@novel-master/core`（在讲「renderer 严禁直连」这件事本身）。不剥注释的话，
 * 「renderer 里出现了 core 字样」这条断言会被注释里的散文误伤，将来谁写一句
 * 「这里本来可以直接 import @novel-master/core」的注释就得来改测试。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const rendererRoot = path.join(desktopRoot, "renderer");
const sharedLogicRoot = path.join(desktopRoot, "shared", "logic");
const CORE_SPECIFIER = "@novel-master/core";

/** 递归列出 .ts / .tsx 源文件（排序，保证报错信息稳定）。 */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

function rel(absolute: string): string {
  return path.relative(desktopRoot, absolute).split(path.sep).join("/");
}

/**
 * 剥掉注释与非模块字符串，只留「代码」。
 *
 * 顺序有讲究：先把字符串字面量处理掉，再删注释。反过来的话，URL 里的 `//`
 * （`"https://x"`）会被当成行注释起点，把后面整行吃掉。
 *
 * ⚠️ **core 模块说明符必须原样留下**——它既是「有没有直连」的判定依据，
 * 也是后面抽绑定名的锚点。所以掩码时按内容分流：内容形如 `@novel-master/core…`
 * 的字符串保留，其余（含模板字符串、URL、提示文案）统一抹成 `""`。
 * 只看「是否包含」是不够的：一句 `"这里禁止 import @novel-master/core"` 的散文
 * 会被当成真引用，那是假红。
 *
 * 已知局限：正则字面量里的 `//`（如 `/\/\//`）仍可能被误判为行注释起点——
 * 本仓 renderer 侧没有这种写法，且真出现了会表现为**误报**（假红），不是漏报。
 */
function stripNonCode(source: string): string {
  return source
    .replace(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g, (raw) =>
      /^@novel-master\/core(?:[/'"]|$)/.test(raw.slice(1, -1)) ? raw : '""',
    )
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/**
 * 从一条 import/export 语句的说明符部分里抽出本地名。
 * `a as b` 取 b（本地名）；`type X` **要**取 X —— 类型导入同样是把 core 拖进
 * renderer 的依赖面，漏掉它等于给 `import type { X } from "@novel-master/core/..."` 开了后门。
 */
function parseBindingNames(clause: string): string[] {
  return clause
    .split(",")
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => raw.replace(/^type\s+/, ""))
    .map((raw) => raw.split(/\s+as\s+/).pop()?.trim() ?? raw)
    .filter((raw): raw is string => raw.length > 0);
}

/** 一条指向 core 的语句：谁、哪个子路径、绑定了哪些本地名。 */
type CoreBinding = {
  readonly file: string;
  readonly kind: "import" | "export";
  readonly module: string;
  readonly names: readonly string[];
};

/**
 * 语句正则：行首的 import/export … from "<core 子路径>"。
 *
 * 说明符要跨行（`import {\n A,\n B\n} from "…"`），所以主体是 `[\s\S]`；但光靠
 * 惰性量词会被「文件里第一条 import」一路骗到几百行之后那条 core `from`，把中间
 * 整个文件当成这条语句的说明符（实测过一次，报错信息能刷出小半份文件）。三重约束收口：
 * 1. 禁穿 `from`——一条语句只可能在自己那句 `from` 处收尾；
 * 2. 禁穿空行——import/export 的排版不会在说明符中间留空行；
 * 3. 禁穿行首的**语句关键字**——说明符内部的行只会以标识符起头；
 *    `export interface X { … }` 这类声明行会被 3 挡在门外。
 */
const CORE_STATEMENT =
  /^[ \t]*(?:import|export)\b((?:(?!\bfrom\b)(?!\n[ \t]*\n)(?!\n[ \t]*(?:import|export|interface|declare|function|class|const|let|var)\b)[\s\S])*?)\bfrom\s*["'](@novel-master\/core[^"']*)["']/gm;

/** 抽出该文件里所有指向 core 的静态 import / 再导出。 */
function collectCoreStatements(file: string, code: string): CoreBinding[] {
  const found: CoreBinding[] = [];
  for (const match of code.matchAll(CORE_STATEMENT)) {
    const clause = (match[1] ?? "").trim();
    const braces = /\{([\s\S]*?)\}/.exec(clause);
    const names = braces ? parseBindingNames(braces[1] ?? "") : [];
    // `import * as ns from` / `import Def from`（无花括号）也记一笔，别让 default/namespace 溜过去。
    const bare = clause.replace(/\{[\s\S]*?\}/g, "").replace(/^\s*type\s+/, "").trim();
    if (bare.length > 0) names.push(...parseBindingNames(bare));
    found.push({
      file: rel(file),
      kind: match[0].trimStart().startsWith("import") ? "import" : "export",
      module: match[2] ?? CORE_SPECIFIER,
      names,
    });
  }
  return found;
}

function readCode(absolute: string): string {
  return stripNonCode(readFileSync(absolute, "utf8"));
}

describe("X1 结构快照：renderer 侧零直连 core（wave-e X1.5）", () => {
  it("renderer/** 源码里不出现任何 @novel-master/core 引用", () => {
    // 判据①的牙齿：把 renderer 某个 import 改回 `@novel-master/core/xxx` ⇒ 本用例红。
    // 判据②不涉及进程级状态；判据③本条只挂一套期望。
    const files = listSourceFiles(rendererRoot);
    assert.ok(files.length > 0, `renderer 扫描面为空（${rel(rendererRoot)}）—— 断言会空转，先修扫描面`);
    const offenders = files
      .map((file) => ({ file, code: readCode(file) }))
      .filter(({ code }) => code.includes(CORE_SPECIFIER))
      .map(({ file }) => rel(file));
    assert.deepEqual(
      offenders,
      [],
      `renderer 直连了 ${CORE_SPECIFIER}（${offenders.length} 个文件）：core 入口一律经 shared/logic 再导出。` +
        `\n改法：把该符号加进 apps/desktop/shared/logic/*.ts 的具名薄再导出，renderer 改从 shared/logic 取。`,
    );
  });

  it("renderer/** 的 core import 绑定集合为空（具名 / default / namespace 全算）", () => {
    // 上一条是「字样级」，本条是「绑定级」：万一有人用拼接等方式绕开字面量，
    // 绑定集合仍按语句结构判定。两层各管一段，不重复。
    const bindings = listSourceFiles(rendererRoot).flatMap((file) =>
      collectCoreStatements(file, readCode(file)),
    );
    assert.deepEqual(
      bindings,
      [],
      `renderer 存在指向 core 的语句：` +
        JSON.stringify(bindings.map((b) => `${b.file} ${b.kind} ${b.module} [${b.names.join(", ")}]`)),
    );
  });

  it("shared/logic 再导出面非空（对账不许空转）", () => {
    // 防「恒真」的那条：shared 侧一旦被清空，上面两条会变成「空 ⊆ 空」永远绿。
    // 参考量（2026-10-01 本仓实跑，非门禁阈值）：33 条指向 core 的语句 / 217 个绑定符号。
    // 这里只断言「非空」而不写死数字——转发面本就该只增不减，写死反而会在有人合法
    // 合并再导出时误报；真被掏空时这条会红。
    const files = listSourceFiles(sharedLogicRoot);
    assert.ok(files.length > 0, `shared/logic 扫描面为空（${rel(sharedLogicRoot)}）`);
    const bindings = files.flatMap((file) => collectCoreStatements(file, readCode(file)));
    assert.ok(
      bindings.length > 0,
      "shared/logic 里一个 core 再导出都没有了 —— X1 的转发层被掏空，对账失去意义。",
    );
    assert.ok(
      bindings.every((b) => b.kind === "export"),
      "shared/logic 里出现了指向 core 的 import（应当只做再导出，不该反向依赖）。",
    );
  });

  it("集合对账：renderer 的 core 绑定集合 ⊆ shared/logic 的再导出集合", () => {
    // spec X1.5 的原话口径。当前 renderer 侧为空 ⇒ 这是条恒真式的前置约束，
    // 它的价值在于：**一旦有人绕过 shared/logic 直连 core，上一条红之外，
    // 这条会直接点名「该符号在 shared/logic 里没有对应转发」**，给出改法而不只是禁令。
    const exported = new Set<string>();
    for (const file of listSourceFiles(sharedLogicRoot)) {
      for (const binding of collectCoreStatements(file, readCode(file))) {
        for (const name of binding.names) exported.add(`${binding.module}#${name}`);
      }
    }
    const rendererBindings = listSourceFiles(rendererRoot).flatMap((file) =>
      collectCoreStatements(file, readCode(file)),
    );
    const unforwarded = rendererBindings
      .filter((b) => b.names.length > 0)
      .flatMap((b) => b.names.map((name) => `${b.module}#${name}`))
      .filter((key) => !exported.has(key));
    assert.deepEqual(
      unforwarded,
      [],
      `这些 core 符号在 shared/logic 里没有对应转发：${unforwarded.join(", ")}`,
    );
  });
});
