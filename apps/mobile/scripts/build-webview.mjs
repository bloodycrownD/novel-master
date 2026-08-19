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
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(__dirname, '..');
const webRoot = join(mobileRoot, 'src', 'web');
const distRoot = join(mobileRoot, 'webview-dist');
const copyNative = process.argv.includes('--copy-native');

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
];

function readWeb(rel) {
  return readFileSync(join(webRoot, rel), 'utf8');
}

/**
 * 从 src/web 下指定入口加载模块（esbuild bundle 后 data: import；
 * 样式常量单源：禁止在 assemble/build 内再嵌第二份规则）。
 */
/** WebView boot 路径别名：`@web/*` → `src/web/*`（勿与 RN Metro `@/` 混用） */
const webAlias = { '@web': webRoot };

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
  return shellCss.replace(placeholder, richCss);
}

const RICH_CSS_PLACEHOLDER = '/* __RICH_CSS__ */';
const MERMAID_FULLSCREEN_CSS_PLACEHOLDER = '/* __MERMAID_FULLSCREEN_CSS__ */';

/**
 * @param {string} pkgId
 * @param {string} entryAbs
 */
async function bundleAppJs(pkgId, entryAbs) {
  const outDir = join(distRoot, pkgId);
  mkdirSync(outDir, { recursive: true });
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
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

function copyDistToNativeSinks() {
  for (const pkg of PACKAGES) {
    const src = join(distRoot, pkg.id);
    const androidDest = join(
      mobileRoot,
      'android/app/src/main/assets/webview',
      pkg.id,
    );
    const iosDest = join(
      mobileRoot,
      'ios/NovelMaster/WebViewDist',
      pkg.id,
    );
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
    css = injectCss(
      css,
      richCss,
      RICH_CSS_PLACEHOLDER,
      pkg.richCssKey,
    );
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
  mkdirSync(outDir, { recursive: true });

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

  const rel = (p) => relative(mobileRoot, p).replace(/\\/g, '/');
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
  mkdirSync(distRoot, { recursive: true });
  for (const pkg of PACKAGES) {
    await buildPackage(pkg, richStyles, mermaidFullscreenCss);
  }
  if (copyNative) {
    copyDistToNativeSinks();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
