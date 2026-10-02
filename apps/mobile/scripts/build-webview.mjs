/**
 * 用 esbuild 双入口打包 WebView 资源（chat-transcript / rich-document）。
 *
 * 真源：`src/web/{pkg}/webview/main.ts` + styles + 短 index.html
 * 产出（gitignore）：`webview-dist/{pkg}/index.html` + `app.js` + `app.css`
 *
 * 可选 `--copy-native`：拷贝到 Android assets 与 iOS Bundle 源目录。
 *
 * 用法：
 *   npm run build:webview
 *   npm run build:webview:native
 */
import * as esbuild from 'esbuild';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(__dirname, '..');
const repoRoot = join(mobileRoot, '..', '..');
const webRoot = join(mobileRoot, 'src', 'web');
const distRoot = join(mobileRoot, 'webview-dist');
const compatBaselinePath = join(mobileRoot, 'webview-compat-baseline.json');
const copyNative = process.argv.includes('--copy-native');
/** `--update-compat` 只在「明知要抬高基线」时用（如上游库升级），且必须在 PR 里写明理由。 */
const updateCompat = process.argv.includes('--update-compat');

/**
 * X3 门 B · 依赖准入白名单（wave-e X3.2）。
 *
 * 病症链：`composer-input` 的 WebView bundle 曾经在 IIFE 顶层执行
 * `Object.fromEntries`（Chrome 73+），而 minSdkVersion=26 对应 Chromium 58
 * ⇒ 旧 WebView 顶层 TypeError，编辑器不挂载、ready 不上报，宿主等不到握手
 * ⇒ chat 内联输入框白屏级无响应。根因是一串 barrel import：为了拿 3 个宏白名单
 * 字符串常量，经 `@novel-master/core/*` barrel 把 `infra/tdbc/index.js`（数据库驱动
 * 抽象层）和 `domain/provider/logic/builtin-providers.js` 一起拖进了 bundle，
 * 后者正是 `BUILTIN_DEFAULT_API_KEY_BY_KEY = Object.fromEntries(...)` 的来源。
 *
 * 门 A（eslint 源码级）看不到 `packages/core/dist`，所以只有这道产物级门能对住病根。
 *
 * ⚠️ 匹配纪律：core 归属判定必须按**路径分段**匹配 `packages/core/dist/`，
 * 不能用裸子串 `core/dist/`——`node_modules/@recogito/annotorious-core/dist/...`
 * 会被裸子串误判成 core 模块（这是本条实现时实测踩到的坑：rich-document 一度
 * 被误报成 1 条 core 依赖）。同族的还有 `Object.hasOwn` 必须配
 * `Object\.hasOwn(?!Property)` 负向断言，否则 `Object.hasOwnProperty` 误伤。
 *
 * 白名单纪律：每条都要能回答「删了会怎样」。chat-transcript 那 60 条是 vfs-tools /
 * search-tool / agent-tool / sqlite-vfs-revision 等工具实现的传递闭包，
 * 收敛它是独立议题（与性能波合并评估），本条只把它原样写成基线。
 */
const WEBVIEW_CORE_ALLOWLIST = {
  'chat-transcript': [
    'bootstrap/skills/skills-schema.js',
    'bootstrap/smart-sort-rule/builtin-smart-sort-rules.js',
    'bootstrap/smart-sort-rule/smart-sort-rule-schema.js',
    'bootstrap/workplace/workplace-schema.js',
    'domain/agent/logic/merge-agent-definition-patch.js',
    'domain/agent/model/agent-definition.schema.js',
    'domain/character-card/logic/character-card-limits.js',
    'domain/chat/logic/message-content-codec.js',
    'domain/chat/logic/render-dir-attach-tree.js',
    'domain/chat/logic/status-chip-label.js',
    'domain/chat/logic/tool-summary.js',
    'domain/chat/logic/user-vfs-turn-view.js',
    'domain/chat/model/annotate-draft.schema.js',
    'domain/chat/model/composer-draft.schema.js',
    'domain/chat/model/message-attachment.schema.js',
    'domain/chat/model/project-agent-config.schema.js',
    'domain/chat/model/session-agent-config.schema.js',
    'domain/chat/model/user-vfs-pending.schema.js',
    'domain/message-checkpoint/logic/restore-path.js',
    'domain/prompt/logic/agent-prompt-layout-wire.js',
    'domain/prompt/logic/normalize-agent-prompt-layout.js',
    'domain/prompt/logic/validate-agent-prompt-layout.js',
    'domain/prompt/logic/validate-dynamic-macros.js',
    'domain/prompt/model/agent-prompt-layout.js',
    'domain/session-kkv/model/session-kkv-domains.js',
    'domain/skills/model/skill-name.js',
    'domain/smart-sort-rule/model/smart-sort-rule-io.js',
    'domain/smart-sort-rule/model/smart-sort-rule.js',
    'domain/smart-sort-rule/model/smart-sort-rule.schema.js',
    'domain/tool/builtin/agent-tool.js',
    'domain/tool/builtin/curl-tool.js',
    'domain/tool/builtin/overflow-sink.js',
    'domain/tool/builtin/search/engines/bocha.js',
    'domain/tool/builtin/search/engines/brave.js',
    'domain/tool/builtin/search/engines/dispatch.js',
    'domain/tool/builtin/search/engines/duckduckgo.js',
    'domain/tool/builtin/search/engines/searxng.js',
    'domain/tool/builtin/search/engines/tavily.js',
    'domain/tool/builtin/search/search-tool.js',
    'domain/tool/builtin/search/types.js',
    'domain/tool/builtin/skill-tool.js',
    'domain/tool/builtin/subagent-tool.js',
    'domain/tool/builtin/vfs-tools.js',
    'domain/tool/logic/skill-read-truncation.js',
    'domain/tool/logic/tool-output-limits.js',
    'domain/vfs/repositories/impl/normalize-path.js',
    'domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js',
    'domain/workplace/logic/rule-snapshot-codec.js',
    'errors/agent-config-errors.js',
    'errors/prompt-errors.js',
    'errors/tool-errors.js',
    'errors/vfs-errors.js',
    'infra/content-cache/logic/decoded-content-cache.js',
    'infra/prompt-template/macro-scan.js',
    'infra/sql-template/index.js',
    'infra/tdbc/index.js',
    'public/chat.js',
    'service/chat/impl/usage-stats.service.js',
    'service/vfs/impl/vfs.service.js',
    'service/vfs/logic/ensure-import-dir-rules.js',
  ],
  // 实测 0 个 core 模块（annotorious 是 node_modules，不算）。
  'rich-document': [],
  'code-editor': [],
  'composer-input': [],
};

/**
 * X3 门 C · 产物级文本棘轮：5 个老浏览器禁用构造的**调用点**计数。
 *
 * 为什么是「不许变多」而不是「出现即 fail」：chat-transcript 8.8MB、
 * rich-document 8.1MB，主体是第三方库（mermaid / Recogito），
 * 「出现即 fail」第一天就会把 3/4 个包打红。门 A 抓的是**我方源码**新增，
 * 门 C 补的是门 A 够不着的一类：**某个我们控制的一手依赖升级**（换 CodeMirror /
 * mermaid 版本）把新构造带进来。
 *
 * ⚠️ 计数口径必须写死成「调用点」而不是「子串」（否则第一天就把伪信号固化成基线）：
 * 实测 chat-transcript 里我方仅 9 处 `replaceAll` 命中，逐处开源码复核全部是
 * zod 的**字段名与中文描述文本**（`skill-tool.js` 的 `replaceAll: z.boolean()...`、
 * `vfs-tools.js` 的 `{oldString, newString, replaceAll: input.replaceAll}`），
 * 没有一处是 `String.prototype.replaceAll` 调用。按子串计数的话，上游改个字段名
 * 棘轮就红。
 *
 * ⚠️ **定位声明（CR-F16）**：门 C 只对「我方源码原样进产物」有效。产物是 esbuild
 * target=es2018 的降级输出 + 上游第三方库（mermaid / zod / Recogito / CodeMirror），
 * 第三方库的降级/压缩形态数不到——它不承诺覆盖产物里的每一个受限构造。
 * 计算属性形态（`Object['fromEntries']`）也不进产物面：产物里极少出现，真出现了说明有人
 * 在手写绕过；这类形态由门 A 在**源码面**兜住（apps/mobile/eslint.config.mjs）。
 *
 * ⚠️ 分隔符形态为什么要容忍（CR-F16）：紧贴正则只认 `Object.fromEntries(`。实测「点号后插
 * 一段块注释再跟左括号」与「点号后换行」这两种换形全部漏检，而「注释 + 换行」恰是压缩/降级
 * 输出的常态。5 条正则统一用 SEP 拼接（空白 + 注释都算分隔符）；
 * `Array.at` 保持原样（它的正则是「标识符链 + 点号 + at(」，放宽会误伤同名标识符）。
 *
 * ⚠️⚠️ SEP 里的**块注释分支必须带上界**（CR-F16 补，前一版写 `[^]*?` 是真的坑）：
 * `String.replaceAll` 那条以字面 `.` 起头，等于「文件里每个点号都是起点」；再叠一个无界的
 * 惰性块注释 `[^]*?`，在 minify:false 的 8.8 MiB 未压缩产物上会病态回溯——实测单这一个构造
 * 在 webview-dist/chat-transcript/app.js 上跑 **>45 s 仍未结束**，把 `node scripts/build-webview.mjs`
 * 整条构建卡死在门 C（构建日志停在 chat-transcript 的三行「已生成」，后面三个包一个都没出）。
 * 有界化（`[^]{0,512}?`）后同一文件同一构造 **9 ms**、命中数 37 不变。
 * 行注释分支实测无此问题（8 ms），保持无界——真实代码里的行注释天然被换行截断，扫不远。
 */
const SEP = '(?:\\s|/\\*[^]{0,512}?\\*/|//[^\\n]*\\n)*';
const WEBVIEW_COMPAT_CONSTRUCTS = {
  'Object.fromEntries': new RegExp(`Object${SEP}\\.${SEP}fromEntries${SEP}\\(`, 'g'),
  'String.replaceAll': new RegExp(`\\.${SEP}replaceAll${SEP}\\(`, 'g'),
  // 负向断言是必须的：`Object.hasOwnProperty` 是 ES5 全兼容的合法写法（CodeMirror 的
  // jsonParse 就在用），裸子串 `Object.hasOwn` 会把它误伤。
  'Object.hasOwn': new RegExp(`Object${SEP}\\.${SEP}hasOwn(?!Property)${SEP}\\(`, 'g'),
  'structuredClone': new RegExp(`\\bstructuredClone${SEP}\\(`, 'g'),
  'Array.at': /(?<![\w$])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.at\(/g,
};

/** @type {{ id: string, entryRel: string, cssRel: string, htmlRel: string, richCssKey?: 'CHAT_TRANSCRIPT_RICH_CSS' | 'RICH_DOCUMENT_RICH_CSS', mermaidFullscreenCss?: boolean }[]} */
const PACKAGES = [
  {
    id: 'chat-transcript',
    entryRel: 'chat-transcript/webview/main.ts',
    cssRel: 'chat-transcript/styles/transcript.css',
    htmlRel: 'chat-transcript/index.html',
    richCssKey: 'CHAT_TRANSCRIPT_RICH_CSS',
    mermaidFullscreenCss: true,
  },
  {
    id: 'rich-document',
    entryRel: 'rich-document/webview/main.ts',
    cssRel: 'rich-document/styles/document.css',
    htmlRel: 'rich-document/index.html',
    richCssKey: 'RICH_DOCUMENT_RICH_CSS',
    mermaidFullscreenCss: true,
  },
  {
    id: 'code-editor',
    entryRel: 'code-editor/webview/main.ts',
    cssRel: 'code-editor/styles/editor.css',
    htmlRel: 'code-editor/index.html',
  },
  {
    id: 'composer-input',
    entryRel: 'composer-input/webview/main.ts',
    cssRel: 'composer-input/styles/composer-input.css',
    htmlRel: 'composer-input/index.html',
  },
];

function readWeb(rel) {
  return readFileSync(join(webRoot, rel), 'utf8');
}

/**
 * 从 src/web 下指定入口加载模块（esbuild bundle 后 data: import；
 * 样式常量单源：禁止在 assemble/build 内再嵌第二份规则）。
 */
/** WebView boot 路径别名：`@web/*` → `src/web/*`（勿与 RN Metro `@/` 混用） */
/** `@/` → `src/`：webview bundle 可引用 RN 侧共享纯函数（src/webview-host，真源） */
const webAlias = {'@web': webRoot, '@': join(mobileRoot, 'src')};

async function loadWebModule(entryRel) {
  const result = await esbuild.build({
    entryPoints: [join(webRoot, entryRel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'warning',
    alias: webAlias,
  });
  const code = result.outputFiles[0].text;
  const mod = await import(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`
  );
  return mod;
}

function injectCss(shellCss, richCss, placeholder, label) {
  if (!shellCss.includes(placeholder)) {
    throw new Error(`shell CSS 缺少 ${placeholder} 占位（${label}）`);
  }
  // 函数形式替换：字符串形式会把 richCss 里的 $$/$&/$' 等当替换模式展开，静默破坏注入
  return shellCss.replace(placeholder, () => richCss);
}

const RICH_CSS_PLACEHOLDER = '/* __RICH_CSS__ */';
const MERMAID_FULLSCREEN_CSS_PLACEHOLDER = '/* __MERMAID_FULLSCREEN_CSS__ */';

/**
 * @param {string} pkgId
 * @param {string} entryAbs
 * @returns {Promise<{outfile: string, metafile: import('esbuild').Metafile}>}
 */
async function bundleAppJs(pkgId, entryAbs) {
  const outDir = join(distRoot, pkgId);
  mkdirSync(outDir, {recursive: true});
  const outfile = join(outDir, 'app.js');
  const result = await esbuild.build({
    entryPoints: [entryAbs],
    bundle: true,
    format: 'iife',
    minify: false,
    platform: 'browser',
    target: ['es2018'],
    outfile,
    logLevel: 'warning',
    // Preact automatic JSX（jsxImportSource → preact/jsx-runtime）
    jsx: 'automatic',
    jsxImportSource: 'preact',
    // 仅允许解析 web/shared 与本包；禁止拉进 RN 组件树
    packages: 'bundle',
    alias: webAlias,
    // 门 B 的输入清单来源；metafile 不改变产物输出。
    metafile: true,
  });
  return {outfile, metafile: result.metafile};
}

/**
 * 读 metafile 里本包产物的 inputs 键集合。
 *
 * ⚠️ 键是**相对 esbuild 的 cwd**（本脚本由 `apps/mobile` 启动 ⇒ 键形如
 * `webview-dist/composer-input/app.js`）。拿绝对 `outfile` 去索引会拿到 undefined，
 * 紧接着的 `.inputs` 直接抛错。所以要么用相对键，要么取第一个 output——
 * 每次 `bundleAppJs` 只产一个 output，这里两种都做（相对键优先，取不到再回落）。
 *
 * @param {import('esbuild').Metafile} metafile
 * @param {string} pkgId
 * @param {string} outfile
 * @returns {string[]}
 */
function readMetafileInputs(metafile, pkgId, outfile) {
  if (!metafile || !metafile.outputs) {
    throw new Error(`esbuild 未返回 metafile，门 B 失效（pkg=${pkgId}）`);
  }
  const outputs = metafile.outputs;
  const relativeKey = relative(process.cwd(), outfile).replace(/\\/g, '/');
  const entry =
    outputs[relativeKey] ??
    Object.values(outputs).find(
      out => out.entryPoint !== undefined && relativeKey.endsWith('app.js'),
    ) ??
    Object.values(outputs)[0];
  if (!entry) {
    throw new Error(
      `metafile.outputs 里找不到 ${relativeKey}（pkg=${pkgId}），门 B 失效`,
    );
  }
  return Object.keys(entry.inputs);
}

/** 归一为相对仓根的 posix 路径，让 core 归属判定与 cwd 无关。 */
function toRepoPosix(p) {
  return relative(repoRoot, p).replace(/\\/g, '/');
}

/**
 * 门 B：产物里出现白名单外的 core dist 模块 ⇒ 打印「谁 import 了它」并 exit 1。
 *
 * ⚠️ 归因要读**顶层** `metafile.inputs[x].imports`，不是 `metafile.outputs[k].inputs[x]`——
 * 后者只有 `bytesInOutput`，没有 imports 字段（实测踩过：拿 outputs 侧的 inputs 去查
 * import 关系恒为空，门 B 会退化成「只报模块名、不报谁引的」）。
 *
 * @param {string} pkgId
 * @param {import('esbuild').Metafile} metafile
 * @param {string} outfile
 */
function assertCoreAllowlist(pkgId, metafile, outfile) {
  const inputs = readMetafileInputs(metafile, pkgId, outfile);
  const allowlist = new Set(WEBVIEW_CORE_ALLOWLIST[pkgId] ?? []);
  const offenders = [];
  for (const raw of inputs) {
    const posix = raw.replace(/\\/g, '/');
    // 路径分段匹配：node_modules/@recogito/annotorious-core/dist/… 不能算 core。
    const match = /(?:^|\/)packages\/core\/dist\/(.+)$/.exec(posix);
    if (!match) continue;
    const moduleId = match[1];
    if (!allowlist.has(moduleId)) offenders.push(moduleId);
  }
  if (offenders.length === 0) return;

  // 反查每个越界模块的引用方。
  // ⚠️ `imports[].path` 已经是**相对 esbuild cwd**（= 本脚本启动目录 apps/mobile）的路径，
  // 不是相对引用方目录的。再 join(dirname(importer)) 会二次解析、把
  // `infra/sql-template/index.js` 变成 `domain/packages/core/dist/infra/…`，
  // 归因就永远对不上 offender 的 moduleId（实测踩过）。
  const importerOf = new Map();
  for (const [importer, meta] of Object.entries(metafile.inputs ?? {})) {
    const importerPosix = normalizePosix(importer);
    const isFirstParty = importerPosix.startsWith('src/');
    for (const imp of meta.imports ?? []) {
      const coreMatch = /(?:^|\/)packages\/core\/dist\/(.+)$/.exec(
        normalizePosix(imp.path),
      );
      if (!coreMatch) continue;
      const bucket = importerOf.get(coreMatch[1]) ?? new Set();
      if (isFirstParty) {
        // 一方源码的引用点才是开发者要改的那一行：给「文件 + 原始 specifier」。
        bucket.add(`${toRepoPosix(join(process.cwd(), importerPosix))}  ${imp.original ?? ''}`.trim());
      } else if (imp.original?.startsWith('@novel-master/core')) {
        bucket.add(`core 内部转发：${imp.original}`);
      }
      importerOf.set(coreMatch[1], bucket);
    }
  }

  console.error(
    `\n[gate B / webview core allowlist] RED: package ${pkgId} pulls ${offenders.length} core module(s) outside the allowlist\n`,
  );
  for (const moduleId of offenders.sort()) {
    console.error(`  packages/core/dist/${moduleId}`);
    const importers = [...(importerOf.get(moduleId) ?? [])].sort();
    if (importers.length > 0) {
      console.error(`    <- imported by: ${importers.join(' | ')}`);
    }
    console.error(
      '    fix: deep-import the leaf module (skip the barrel) or inline the constant on the',
      '    webview side. Only if it is genuinely needed, add it to WEBVIEW_CORE_ALLOWLIST in',
      '    scripts/build-webview.mjs and justify "what breaks if we drop it" in the PR.',
    );
  }
  process.exit(1);
}

function normalizePosix(p) {
  return p.replace(/\\/g, '/');
}


/**
 * 门 C：产物级文本棘轮。任一构造的调用点计数**上升**即 fail；下降是预期（清账）。
 *
 * @param {string} pkgId
 * @param {string} outfile
 */
function assertCompatCounts(pkgId, outfile) {
  const code = readFileSync(outfile, 'utf8');
  const measured = {};
  for (const [name, re] of Object.entries(WEBVIEW_COMPAT_CONSTRUCTS)) {
    measured[name] = (code.match(re) ?? []).length;
  }
  const baseline = JSON.parse(readFileSync(compatBaselinePath, 'utf8'));
  const recorded = baseline.packages?.[pkgId];

  if (updateCompat) {
    baseline.packages[pkgId] = measured;
    writeFileSync(
      compatBaselinePath,
      `${JSON.stringify(baseline, null, 2)}\n`,
      'utf8',
    );
    console.log(`[gate C] baseline rewritten ${pkgId}: ${JSON.stringify(measured)}`);
    return;
  }

  if (!recorded) {
    console.error(
      `[gate C] RED: no baseline for package ${pkgId} in webview-compat-baseline.json. ` +
        'Run `node scripts/build-webview.mjs --update-compat` and justify it in the PR.',
    );
    process.exit(1);
  }
  const regressions = Object.keys(WEBVIEW_COMPAT_CONSTRUCTS).filter(
    name => measured[name] > (recorded[name] ?? 0),
  );
  if (regressions.length === 0) {
    const summary = Object.keys(WEBVIEW_COMPAT_CONSTRUCTS)
      .map(name => `${name}=${measured[name]}`)
      .join(' ');
    console.log(`[gate C] GREEN ${pkgId}: ${summary}`);
    return;
  }
  console.error(
    `\n[gate C / webview compat ratchet] RED: package ${pkgId} gained restricted-construct call sites\n`,
  );
  for (const name of regressions) {
    console.error(
      `  ${name}: baseline ${recorded[name] ?? 0} -> measured ${measured[name]} (+${measured[name] - (recorded[name] ?? 0)})`,
    );
  }
  console.error(
    '\n  These call sites run on minSdk 26 / Chromium 58. Fix: rewrite them to an',
    '  old-browser equivalent. Only if it is genuinely out of your control (e.g. an upstream',
    '  library upgrade pulled it in) run --update-compat and justify the new baseline in the PR.',
  );
  process.exit(1);
}

/**
 * @param {string} src
 * @param {string} dest
 */
function replaceCopyDir(src, dest) {
  rmSync(dest, {recursive: true, force: true});
  mkdirSync(dirname(dest), {recursive: true});
  cpSync(src, dest, {recursive: true});
}

function copyDistToNativeSinks() {
  for (const pkg of PACKAGES) {
    const src = join(distRoot, pkg.id);
    const androidDest = join(
      mobileRoot,
      'android/app/src/main/assets/webview',
      pkg.id,
    );
    const iosDest = join(mobileRoot, 'ios/NovelMaster/WebViewDist', pkg.id);
    replaceCopyDir(src, androidDest);
    replaceCopyDir(src, iosDest);
    console.log(
      `已拷贝原生落点 ${relative(mobileRoot, androidDest).replace(/\\/g, '/')}`,
    );
    console.log(
      `已拷贝原生落点 ${relative(mobileRoot, iosDest).replace(/\\/g, '/')}`,
    );
  }
}

/**
 * @param {typeof PACKAGES[number]} pkg
 * @param {Record<string, string>} richStyles
 * @param {string} mermaidFullscreenCss
 */
async function buildPackage(pkg, richStyles, mermaidFullscreenCss) {
  const entryAbs = join(webRoot, pkg.entryRel);
  let css = readWeb(pkg.cssRel);
  if (pkg.richCssKey) {
    const richCss = richStyles[pkg.richCssKey];
    if (typeof richCss !== 'string' || !richCss) {
      throw new Error(`缺少富文本 CSS：${pkg.richCssKey}`);
    }
    css = injectCss(css, richCss, RICH_CSS_PLACEHOLDER, pkg.richCssKey);
  }
  // mermaid 全屏查看器样式（选择器不带 .bubble.rich 前缀 → 独立注入位）
  if (pkg.mermaidFullscreenCss) {
    css = injectCss(
      css,
      mermaidFullscreenCss,
      MERMAID_FULLSCREEN_CSS_PLACEHOLDER,
      'MERMAID_FULLSCREEN_CSS',
    );
  }
  const html = readWeb(pkg.htmlRel);
  const outDir = join(distRoot, pkg.id);
  mkdirSync(outDir, {recursive: true});

  const {outfile: jsPath, metafile} = await bundleAppJs(pkg.id, entryAbs);
  // 门 B：依赖准入（白名单外的 core dist 模块 ⇒ 红）。
  assertCoreAllowlist(pkg.id, metafile, jsPath);
  // rich-document：把 Recogito 样式打进 app.css（file:// WebView 不能靠 CDN）
  if (pkg.id === 'rich-document') {
    const recogitoCssPath = require.resolve(
      '@recogito/text-annotator/text-annotator.css',
    );
    css = `${css}\n/* @recogito/text-annotator */\n${readFileSync(
      recogitoCssPath,
      'utf8',
    )}\n`;
  }
  const cssPath = join(outDir, 'app.css');
  const htmlPath = join(outDir, 'index.html');
  writeFileSync(cssPath, css, 'utf8');
  writeFileSync(htmlPath, html, 'utf8');

  const rel = p => relative(mobileRoot, p).replace(/\\/g, '/');
  console.log(`已生成 ${rel(htmlPath)}`);
  console.log(`已生成 ${rel(jsPath)}`);
  console.log(`已生成 ${rel(cssPath)}`);
  // 门 C：产物级文本棘轮（计数上升即红）。放在最后写 css/html 之后，
  // 这样失败时产物已经落盘，方便直接开 app.js 定位。
  assertCompatCounts(pkg.id, jsPath);
}

async function main() {
  const richStyles = await loadWebModule('shared/rich-content-styles.ts');
  const fullscreenStyles = await loadWebModule(
    'shared/mermaid-fullscreen/mermaid-fullscreen-styles.ts',
  );
  const mermaidFullscreenCss = fullscreenStyles.MERMAID_FULLSCREEN_CSS;
  if (typeof mermaidFullscreenCss !== 'string' || !mermaidFullscreenCss) {
    throw new Error('缺少 mermaid 全屏 CSS：MERMAID_FULLSCREEN_CSS');
  }
  mkdirSync(distRoot, {recursive: true});
  for (const pkg of PACKAGES) {
    await buildPackage(pkg, richStyles, mermaidFullscreenCss);
  }
  if (copyNative) {
    copyDistToNativeSinks();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
