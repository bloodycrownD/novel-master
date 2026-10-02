/**
 * 用 esbuild 多入口打包 WebView 资源（chat-transcript / rich-document /
 * code-editor / composer-input / chat-conversation）。
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
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(__dirname, '..');
const webRoot = join(mobileRoot, 'src', 'web');
const distRoot = join(mobileRoot, 'webview-dist');
const copyNative = process.argv.includes('--copy-native');

/** @type {{ id: string, entryRel: string, cssRel: string | string[], htmlRel: string, richCssKey?: 'CHAT_TRANSCRIPT_RICH_CSS' | 'RICH_DOCUMENT_RICH_CSS', mermaidFullscreenCss?: boolean }[]} */
const PACKAGES = [
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
  {
    // chat-conversation（chat-webview-unify Step 2 / transcript-converge 收官）：
    // 转录 + 输入框 dock + 会话列表合成包，唯一宿主文档。cssRel 数组 =
    // 构建期 join：transcript.css（转录基底，源自已退役的旧文档包、现作纯
    // 样式库保留）在前，chat-conversation.css（增量：dock/列表/转场/变体）
    // 在后——层叠序与「基底手抄在前」的旧形态一致。推翻 Step 2 的
    // 「不做数组 join」决策（transcript-converge ②：根治 11KB 基底手抄的
    // 漂移风险，selector 覆盖断言由 chat-conversation-boot-script.test 兜）。
    id: 'chat-conversation',
    entryRel: 'chat-conversation/webview/main.ts',
    cssRel: [
      'chat-transcript/styles/transcript.css',
      'chat-conversation/styles/chat-conversation.css',
    ],
    htmlRel: 'chat-conversation/index.html',
    richCssKey: 'CHAT_TRANSCRIPT_RICH_CSS',
    mermaidFullscreenCss: true,
  },
];

/** 存活包 id 清单（pruneDist 的 keep 口径；与 PACKAGES 同源，勿另抄）。 */
const PACKAGE_IDS = PACKAGES.map(p => p.id);

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
 */
async function bundleAppJs(pkgId, entryAbs) {
  const outDir = join(distRoot, pkgId);
  mkdirSync(outDir, {recursive: true});
  const outfile = join(outDir, 'app.js');
  await esbuild.build({
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
  });
  return outfile;
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

/**
 * 退役包产物清理（cr2-K-2）：删掉根目录下所有「不在 keepIds 里的目录」。
 *
 * 为什么必须清：包从 PACKAGES 退役后，旧工作区里已构建的
 * `webview-dist/{retired}/` 与两端原生落点的同名目录不会被覆盖、也不会被覆盖
 * 地删掉——Android assets 与 iOS `cp -R "$SRC/"` 整目录递归都会把它们原样
 * 打进 APK/IPA。读侧「URL 拼不出来」只能挡住调用方，挡不住产物面。
 *
 * 口径：只删目录；`.gitkeep` 之类文件不动；根目录不存在直接返回（首次构建）。
 *
 * @param {string} rootDir
 * @param {string[]} keepIds 存活包 id（通常即 PACKAGES.map(p => p.id)）
 */
function pruneDist(rootDir, keepIds) {
  let entries;
  try {
    entries = readdirSync(rootDir, {withFileTypes: true});
  } catch {
    return; // 根目录还没建：无需清理
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (keepIds.includes(entry.name)) continue;
    const stale = join(rootDir, entry.name);
    rmSync(stale, {recursive: true, force: true});
    console.log(`已清理退役包产物 ${relative(mobileRoot, stale).replace(/\\/g, '/')}`);
  }
}

function copyDistToNativeSinks() {
  // 两端原生落点根目录同样可能有退役包残留（iOS `cp -R` 整目录递归，会原样进包）
  pruneDist(join(mobileRoot, 'android/app/src/main/assets/webview'), PACKAGE_IDS);
  pruneDist(join(mobileRoot, 'ios/NovelMaster/WebViewDist'), PACKAGE_IDS);
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
  // cssRel 数组 = 构建期 join（顺序即层叠序，见 PACKAGES 注释）；单值保持原样。
  const cssSources = Array.isArray(pkg.cssRel) ? pkg.cssRel : [pkg.cssRel];
  let css = cssSources.map(rel => readWeb(rel)).join('\n');
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

  const jsPath = await bundleAppJs(pkg.id, entryAbs);
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
  // 退役包产物清理：先剪枝再构建，避免旧工作区残留混进 distRoot（cr2-K-2）
  pruneDist(distRoot, PACKAGE_IDS);
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
