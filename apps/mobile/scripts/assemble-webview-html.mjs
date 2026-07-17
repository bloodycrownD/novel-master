/**
 * 【遗留】组装 chat-transcript / rich-document WebView *.assembled.html。
 *
 * 主路径已由 `build-webview.mjs`（esbuild + TS ESM）接替；本脚本仅供过渡期
 * 契约测读 assembled HTML，Step 8 删除。
 *
 * 常量真源：`src/web/shared/constants.ts`
 * 富文本 CSS 真源：`src/web/shared/rich-content-styles.ts`（禁止内嵌第二份规则）
 *
 * 用法：npm run assemble:webview-html -w @novel-master/mobile
 */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(__dirname, '..');
const webRoot = join(mobileRoot, 'src', 'web');
const repoRoot = join(mobileRoot, '..', '..');

/** 全部从 shared/constants.ts 抽取（单源）。 */
const CONST_NAMES = [
  { exportName: 'NEAR_BOTTOM_THRESHOLD_PX', bootName: 'NEAR_BOTTOM' },
  { exportName: 'MENU_OPEN_GRACE_MS', bootName: 'MENU_OPEN_GRACE_MS' },
  {
    exportName: 'LONG_PRESS_MOVE_TOLERANCE_PX',
    bootName: 'LONG_PRESS_MOVE_TOLERANCE_PX',
  },
  { exportName: 'ANCHORED_MENU_GAP', bootName: 'ANCHORED_MENU_GAP' },
  {
    exportName: 'ANCHORED_MENU_SCREEN_MARGIN',
    bootName: 'ANCHORED_MENU_SCREEN_MARGIN',
  },
  {
    exportName: 'ANCHORED_MENU_ITEM_MIN_HEIGHT',
    bootName: 'ANCHORED_MENU_ITEM_MIN_HEIGHT',
  },
  {
    exportName: 'ANCHORED_MENU_ITEM_LAYOUT_HEIGHT',
    bootName: 'ANCHORED_MENU_ITEM_LAYOUT_HEIGHT',
  },
  {
    exportName: 'ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT',
    bootName: 'ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT',
  },
  {
    exportName: 'ANCHORED_MENU_MAX_HEIGHT_CAP',
    bootName: 'ANCHORED_MENU_MAX_HEIGHT_CAP',
  },
  { exportName: 'ANCHORED_MENU_MIN_WIDTH', bootName: 'ANCHORED_MENU_MIN_WIDTH' },
  { exportName: 'ANCHORED_MENU_MAX_WIDTH', bootName: 'ANCHORED_MENU_MAX_WIDTH' },
  {
    exportName: 'ANCHORED_MENU_H_PADDING',
    bootName: 'ANCHORED_MENU_H_PADDING',
  },
  {
    exportName: 'ANCHORED_MENU_CHAR_WIDTH_EST',
    bootName: 'ANCHORED_MENU_CHAR_WIDTH_EST',
  },
  {
    exportName: 'MESSAGE_ACTION_MENU_ITEM_COUNT',
    bootName: 'MESSAGE_ACTION_MENU_ITEM_COUNT',
  },
];

function read(relOrAbs) {
  const p = relOrAbs.startsWith(mobileRoot)
    ? relOrAbs
    : join(mobileRoot, relOrAbs);
  return readFileSync(p, 'utf8');
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
  return import(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`
  );
}

function buildGeneratedConstantsSource() {
  const src = read('src/web/shared/constants.ts');
  const lines = [
    '/** 由 assemble 从 shared/constants.ts 内联（遗留；不落盘）。 */',
  ];
  for (const row of CONST_NAMES) {
    const value = extractExportConstNumber(src, row.exportName);
    lines.push(`var ${row.bootName} = ${value};`);
  }
  lines.push('');
  return lines.join('\n');
}

function concatTranscriptBoot() {
  const parts = [
    buildGeneratedConstantsSource(),
    read('src/web/shared/boot/decode-entities.js'),
    read('src/web/chat-transcript/boot/html-escape.js'),
    read('src/web/chat-transcript/boot/stream-markdown.js'),
    read('src/web/chat-transcript/boot/state.js'),
    read('src/web/chat-transcript/boot/vfs-tool-path.js'),
    read('src/web/chat-transcript/boot/scroll.js'),
    read('src/web/chat-transcript/boot/tool-render.js'),
    read('src/web/chat-transcript/boot/row-render.js'),
    read('src/web/chat-transcript/boot/menu.js'),
    read('src/web/chat-transcript/boot/stream.js'),
    read('src/web/chat-transcript/boot/snapshot.js'),
    read('src/web/chat-transcript/boot/rows-click.js'),
    read('src/web/chat-transcript/boot/bridge.js'),
    read('src/web/chat-transcript/boot/main.js'),
  ];
  return `(function () {\n${parts.join('\n')}\n})();`;
}

function concatDocumentBoot() {
  const body = read('src/web/rich-document/boot/main.js');
  return `(function () {\n${body}\n})();`;
}

function injectCss(shellCss, richCss) {
  if (!shellCss.includes('/* __RICH_CSS__ */')) {
    throw new Error('shell CSS 缺少 /* __RICH_CSS__ */ 占位');
  }
  return shellCss.replace('/* __RICH_CSS__ */', richCss);
}

function assembleHtml(shellHtml, css, boot) {
  if (!shellHtml.includes('__CSS__') || !shellHtml.includes('__BOOT__')) {
    throw new Error('shell HTML 缺少 __CSS__ / __BOOT__ 占位');
  }
  return shellHtml.replace('__CSS__', css).replace('__BOOT__', boot);
}

function writeAssembledHtml(outRel, html) {
  const outPath = join(mobileRoot, outRel);
  mkdirSync(dirname(outPath), { recursive: true });
  const banner = `<!-- 由 assemble-webview-html.mjs 生成，禁止手改。重新生成：npm run assemble:webview-html -w @novel-master/mobile -->\n`;
  writeFileSync(outPath, banner + html, 'utf8');
  return outPath;
}

async function main() {
  const rich = await loadRichContentStyles();
  const transcriptCss = injectCss(
    read('src/web/chat-transcript/styles/transcript.css'),
    rich.CHAT_TRANSCRIPT_RICH_CSS,
  );
  const transcriptHtml = assembleHtml(
    read('src/web/chat-transcript/shell/transcript.html'),
    transcriptCss,
    concatTranscriptBoot(),
  );
  const documentCss = injectCss(
    read('src/web/rich-document/styles/document.css'),
    rich.RICH_DOCUMENT_RICH_CSS,
  );
  const documentHtml = assembleHtml(
    read('src/web/rich-document/shell/document.html'),
    documentCss,
    concatDocumentBoot(),
  );

  const tPath = writeAssembledHtml(
    'src/web/chat-transcript/transcript.assembled.html',
    transcriptHtml,
  );
  const dPath = writeAssembledHtml(
    'src/web/rich-document/document.assembled.html',
    documentHtml,
  );

  const rel = (p) => relative(repoRoot, p).replace(/\\/g, '/');
  console.log(`已生成 ${rel(tPath)} (${transcriptHtml.length} chars)`);
  console.log(`已生成 ${rel(dPath)} (${documentHtml.length} chars)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
