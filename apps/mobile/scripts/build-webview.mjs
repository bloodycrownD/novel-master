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
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(__dirname, '..');
const webRoot = join(mobileRoot, 'src', 'web');
const distRoot = join(mobileRoot, 'webview-dist');
const copyNative = process.argv.includes('--copy-native');

/** @type {{ id: string, entryRel: string, cssRel: string, htmlRel: string, richCssKey: 'CHAT_TRANSCRIPT_RICH_CSS' | 'RICH_DOCUMENT_RICH_CSS' }[]} */
const PACKAGES = [
  {
    id: 'chat-transcript',
    entryRel: 'chat-transcript/webview/main.ts',
    cssRel: 'chat-transcript/styles/transcript.css',
    htmlRel: 'chat-transcript/index.html',
    richCssKey: 'CHAT_TRANSCRIPT_RICH_CSS',
  },
  {
    id: 'rich-document',
    entryRel: 'rich-document/webview/main.ts',
    cssRel: 'rich-document/styles/document.css',
    htmlRel: 'rich-document/index.html',
    richCssKey: 'RICH_DOCUMENT_RICH_CSS',
  },
];

function readWeb(rel) {
  return readFileSync(join(webRoot, rel), 'utf8');
}

/**
 * 从 shared/rich-content-styles.ts 加载富文本 CSS（单源，禁止内嵌第二份规则）。
 */
async function loadRichContentStyles() {
  const result = await esbuild.build({
    entryPoints: [join(webRoot, 'shared/rich-content-styles.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'warning',
  });
  const code = result.outputFiles[0].text;
  const mod = await import(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`
  );
  return mod;
}

function injectCss(shellCss, richCss) {
  if (!shellCss.includes('/* __RICH_CSS__ */')) {
    throw new Error('shell CSS 缺少 /* __RICH_CSS__ */ 占位');
  }
  return shellCss.replace('/* __RICH_CSS__ */', richCss);
}

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
    // Preact classic JSX（源码显式 import { h, Fragment } from 'preact'）
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    // 仅允许解析 web/shared 与本包；禁止拉进 RN 组件树
    packages: 'bundle',
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
 */
async function buildPackage(pkg, richStyles) {
  const entryAbs = join(webRoot, pkg.entryRel);
  const richCss = richStyles[pkg.richCssKey];
  if (typeof richCss !== 'string' || !richCss) {
    throw new Error(`缺少富文本 CSS：${pkg.richCssKey}`);
  }
  const css = injectCss(readWeb(pkg.cssRel), richCss);
  const html = readWeb(pkg.htmlRel);
  const outDir = join(distRoot, pkg.id);
  mkdirSync(outDir, { recursive: true });

  const jsPath = await bundleAppJs(pkg.id, entryAbs);
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
  const richStyles = await loadRichContentStyles();
  mkdirSync(distRoot, { recursive: true });
  for (const pkg of PACKAGES) {
    await buildPackage(pkg, richStyles);
  }
  if (copyNative) {
    copyDistToNativeSinks();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
