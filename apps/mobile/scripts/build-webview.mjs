/**
 * 用 esbuild 双入口打包 WebView 资源（chat-transcript / rich-document）。
 *
 * 产出（gitignore）：
 *   webview-dist/{pkg}/index.html + app.js + app.css
 *
 * 可选 `--copy-native`：拷贝到 Android assets 与 iOS Bundle 源目录。
 *
 * 本阶段可编辑真源仍为 boot/*.js（concat 烟雾）；完整 TS 迁移见后续节点。
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

/** @type {{ file: string, exportName: string, bootName: string }[]} */
const CONST_TABLE = [
  {
    file: 'src/web/chat-transcript/scroll.ts',
    exportName: 'NEAR_BOTTOM_THRESHOLD_PX',
    bootName: 'NEAR_BOTTOM',
  },
  {
    file: 'src/web/chat-transcript/menu-overlay-guards.ts',
    exportName: 'MENU_OPEN_GRACE_MS',
    bootName: 'MENU_OPEN_GRACE_MS',
  },
  {
    file: 'src/web/chat-transcript/menu-overlay-guards.ts',
    exportName: 'LONG_PRESS_MOVE_TOLERANCE_PX',
    bootName: 'LONG_PRESS_MOVE_TOLERANCE_PX',
  },
  {
    file: 'src/components/chat/anchored-menu-layout.ts',
    exportName: 'ANCHORED_MENU_GAP',
    bootName: 'ANCHORED_MENU_GAP',
  },
  {
    file: 'src/components/chat/anchored-menu-layout.ts',
    exportName: 'ANCHORED_MENU_SCREEN_MARGIN',
    bootName: 'ANCHORED_MENU_SCREEN_MARGIN',
  },
  {
    file: 'src/components/chat/anchored-menu-layout.ts',
    exportName: 'ANCHORED_MENU_ITEM_MIN_HEIGHT',
    bootName: 'ANCHORED_MENU_ITEM_MIN_HEIGHT',
  },
  {
    file: 'src/components/chat/anchored-menu-layout.ts',
    exportName: 'ANCHORED_MENU_ITEM_LAYOUT_HEIGHT',
    bootName: 'ANCHORED_MENU_ITEM_LAYOUT_HEIGHT',
  },
  {
    file: 'src/components/chat/anchored-menu-layout.ts',
    exportName: 'ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT',
    bootName: 'ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT',
  },
  {
    file: 'src/components/chat/anchored-menu-layout.ts',
    exportName: 'ANCHORED_MENU_MAX_HEIGHT_CAP',
    bootName: 'ANCHORED_MENU_MAX_HEIGHT_CAP',
  },
  {
    file: 'src/components/chat/anchored-menu-layout.ts',
    exportName: 'ANCHORED_MENU_MIN_WIDTH',
    bootName: 'ANCHORED_MENU_MIN_WIDTH',
  },
  {
    file: 'src/components/chat/anchored-menu-layout.ts',
    exportName: 'ANCHORED_MENU_MAX_WIDTH',
    bootName: 'ANCHORED_MENU_MAX_WIDTH',
  },
  {
    file: 'src/components/chat/anchored-menu-layout.ts',
    exportName: 'ANCHORED_MENU_H_PADDING',
    bootName: 'ANCHORED_MENU_H_PADDING',
  },
  {
    file: 'src/components/chat/anchored-menu-layout.ts',
    exportName: 'ANCHORED_MENU_CHAR_WIDTH_EST',
    bootName: 'ANCHORED_MENU_CHAR_WIDTH_EST',
  },
  {
    file: 'src/components/chat/anchored-menu-layout.ts',
    exportName: 'MESSAGE_ACTION_MENU_ITEM_COUNT',
    bootName: 'MESSAGE_ACTION_MENU_ITEM_COUNT',
  },
];

/**
 * @param {readonly string[]} selectors
 */
function buildRichContentCssRules(selectors) {
  const group = selectors.join(', ');
  const child = (tag) => selectors.map((s) => `${s} ${tag}`).join(', ');
  const nestedList = selectors
    .map((s) => `${s} ul ul, ${s} ol ol, ${s} ul ol, ${s} ol ul`)
    .join(', ');
  const liAdjacent = selectors.map((s) => `${s} li + li`).join(', ');
  const liParagraph = selectors.map((s) => `${s} li > p`).join(', ');
  return `
    ${group} { white-space: normal; overflow-wrap: anywhere; }
    ${child('p')} { margin: 0.35em 0; }
    ${child('p')}:first-child { margin-top: 0; }
    ${child('p')}:last-child { margin-bottom: 0; }
    ${child('ol')}, ${child('ul')} { margin: 0.35em 0; padding-left: 1.5em; list-style-position: outside; }
    ${nestedList} { margin-top: 0.2em; margin-bottom: 0; padding-left: 1.25em; }
    ${child('li')} { margin: 0.15em 0; }
    ${liAdjacent} { margin-top: 0.25em; }
    ${liParagraph} { margin: 0; }
    ${child('strong')}, ${child('b')} { font-weight: 600; }
    ${child('hr')} {
      border: none;
      border-top: 1px solid var(--border, #e5e5ea);
      margin: 0.5em 0;
      opacity: 0.85;
    }
    ${child('blockquote')} {
      margin: 0.35em 0; padding-left: 0.75em;
      border-left: 3px solid var(--border, #e5e5ea);
    }
    ${child('h1')} { font-size: 1.15em; font-weight: 700; margin: 0.4em 0 0.3em; }
    ${child('h2')} { font-size: 1.08em; font-weight: 700; margin: 0.38em 0 0.28em; }
    ${child('h3')} { font-size: 1em; font-weight: 700; margin: 0.35em 0; }
    ${child('code')} { font-family: ui-monospace, monospace; font-size: 0.9em; background: rgba(0,0,0,0.06); padding: 0.1em 0.25em; border-radius: 4px; }
    ${child('pre')} { overflow-x: auto; margin: 0.35em 0; }
    ${child('a')} { color: var(--primary, #007aff); }
  `.trim();
}

const CHAT_TRANSCRIPT_RICH_CSS = buildRichContentCssRules([
  '.bubble.rich',
  '.bubble-body.rich',
  '.thinking-body.rich',
]);

const RICH_DOCUMENT_RICH_CSS = buildRichContentCssRules(['#doc .doc-body.rich']);

/** @type {{ id: string, bodyHtml: string, cssRel: string, richCss: string, bootRels: string[] }[]} */
const PACKAGES = [
  {
    id: 'chat-transcript',
    bodyHtml: '<div id="scroller"><div id="rows"></div></div>',
    cssRel: 'chat-transcript/shell/transcript.css',
    richCss: CHAT_TRANSCRIPT_RICH_CSS,
    bootRels: [
      'chat-transcript/boot/generated-constants.js',
      'shared/boot/decode-entities.js',
      'chat-transcript/boot/html-escape.js',
      'chat-transcript/boot/stream-markdown.js',
      'chat-transcript/boot/state.js',
      'chat-transcript/boot/vfs-tool-path.js',
      'chat-transcript/boot/scroll.js',
      'chat-transcript/boot/tool-render.js',
      'chat-transcript/boot/row-render.js',
      'chat-transcript/boot/menu.js',
      'chat-transcript/boot/stream.js',
      'chat-transcript/boot/snapshot.js',
      'chat-transcript/boot/rows-click.js',
      'chat-transcript/boot/bridge.js',
      'chat-transcript/boot/main.js',
    ],
  },
  {
    id: 'rich-document',
    bodyHtml: '<div id="doc-wrap"><div id="doc"></div></div>',
    cssRel: 'rich-document/shell/document.css',
    richCss: RICH_DOCUMENT_RICH_CSS,
    bootRels: ['rich-document/boot/main.js'],
  },
];

function readMobile(rel) {
  return readFileSync(join(mobileRoot, rel), 'utf8');
}

function readWeb(rel) {
  return readFileSync(join(webRoot, rel), 'utf8');
}

function extractExportConstNumber(source, name) {
  const m = source.match(
    new RegExp(`export const ${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`),
  );
  if (!m) {
    throw new Error(`无法抽取 export const ${name}`);
  }
  return m[1];
}

function writeGeneratedConstants() {
  /** @type {Map<string, string>} */
  const fileCache = new Map();
  const lines = [
    '/**',
    ' * 由 build-webview.mjs 从 TS 源抽取生成，禁止手改。',
    ' * 重新生成：npm run build:webview -w @novel-master/mobile',
    ' */',
  ];
  for (const row of CONST_TABLE) {
    let src = fileCache.get(row.file);
    if (src == null) {
      src = readMobile(row.file);
      fileCache.set(row.file, src);
    }
    const value = extractExportConstNumber(src, row.exportName);
    lines.push(`var ${row.bootName} = ${value};`);
  }
  lines.push('');
  const outPath = join(webRoot, 'chat-transcript/boot/generated-constants.js');
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  return outPath;
}

function injectCss(shellCss, richCss) {
  if (!shellCss.includes('/* __RICH_CSS__ */')) {
    throw new Error('shell CSS 缺少 /* __RICH_CSS__ */ 占位');
  }
  return shellCss.replace('/* __RICH_CSS__ */', richCss);
}

/**
 * 短入口 HTML：外链 CSS + classic script（禁止 type=module）。
 * @param {string} bodyHtml
 */
function buildShortHtml(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="./app.css">
</head>
<body>
  ${bodyHtml}
  <script src="./app.js"></script>
</body>
</html>
`;
}

/**
 * @param {string} pkgId
 * @param {string} bootSource concat 后的 boot 正文（无外层 IIFE）
 */
async function bundleAppJs(pkgId, bootSource) {
  const outDir = join(distRoot, pkgId);
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, 'app.js');
  await esbuild.build({
    stdin: {
      contents: bootSource,
      resolveDir: webRoot,
      sourcefile: `${pkgId}-boot.js`,
      loader: 'js',
    },
    bundle: true,
    format: 'iife',
    minify: false,
    platform: 'browser',
    target: ['es2018'],
    outfile,
    logLevel: 'warning',
  });
  return outfile;
}

/**
 * 递归清空后拷贝目录。
 * @param {string} src
 * @param {string} dest
 */
function replaceCopyDir(src, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

/**
 * 将 webview-dist 拷入 Android assets 与 iOS Bundle 源目录。
 */
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

async function buildPackage(pkg) {
  const bootSource = pkg.bootRels.map((rel) => readWeb(rel)).join('\n');
  const css = injectCss(readWeb(pkg.cssRel), pkg.richCss);
  const outDir = join(distRoot, pkg.id);
  mkdirSync(outDir, { recursive: true });

  const jsPath = await bundleAppJs(pkg.id, bootSource);
  const cssPath = join(outDir, 'app.css');
  const htmlPath = join(outDir, 'index.html');
  writeFileSync(cssPath, css, 'utf8');
  writeFileSync(htmlPath, buildShortHtml(pkg.bodyHtml), 'utf8');

  const rel = (p) => relative(mobileRoot, p).replace(/\\/g, '/');
  console.log(`已生成 ${rel(htmlPath)}`);
  console.log(`已生成 ${rel(jsPath)}`);
  console.log(`已生成 ${rel(cssPath)}`);
}

async function main() {
  writeGeneratedConstants();
  mkdirSync(distRoot, { recursive: true });
  for (const pkg of PACKAGES) {
    await buildPackage(pkg);
  }
  if (copyNative) {
    copyDistToNativeSinks();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
