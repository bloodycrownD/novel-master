/**
 * 组装 chat-transcript / rich-document WebView HTML 生成物。
 *
 * chat-transcript boot concat 顺序（定案，勿改相对顺序）：
 *   1. generated-constants.js（本脚本写出）
 *   2. shared/boot/decode-entities.js
 *   3. chat-transcript/boot/stream-markdown.js
 *   4. chat-transcript/boot/vfs-tool-path.js
 *   5. chat-transcript/boot/runtime.js（其余运行时）
 *   6. chat-transcript/boot/main.js（入口收尾）
 *
 * 用法：npm run assemble:webview-html -w @novel-master/mobile
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(__dirname, '..');
const webRoot = join(mobileRoot, 'src', 'web');
const repoRoot = join(mobileRoot, '..', '..');

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

function read(relOrAbs) {
  const p = relOrAbs.startsWith(mobileRoot) ? relOrAbs : join(mobileRoot, relOrAbs);
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

/**
 * 与 rich-content-styles.ts buildRichContentCssRules 契约等价（assemble 侧纯 JS）。
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
    /* Global reset strips list padding; indent so outside markers stay inside the content area. */
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

function writeGeneratedConstants() {
  /** @type {Map<string, string>} */
  const fileCache = new Map();
  const lines = [
    '/**',
    ' * 由 assemble-webview-html.mjs 从 TS 源抽取生成，禁止手改。',
    ' * 重新生成：npm run assemble:webview-html -w @novel-master/mobile',
    ' */',
  ];
  for (const row of CONST_TABLE) {
    let src = fileCache.get(row.file);
    if (src == null) {
      src = read(row.file);
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

function concatTranscriptBoot() {
  const parts = [
    read('src/web/chat-transcript/boot/generated-constants.js'),
    read('src/web/shared/boot/decode-entities.js'),
    read('src/web/chat-transcript/boot/stream-markdown.js'),
    read('src/web/chat-transcript/boot/vfs-tool-path.js'),
    read('src/web/chat-transcript/boot/runtime.js'),
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

/** 将 HTML 写成可 import 的 TS 字符串常量（转义 ` \\ ${）。 */
function toTsStringLiteral(html) {
  return html
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function writeGeneratedTs(outRel, exportName, html) {
  const outPath = join(mobileRoot, outRel);
  mkdirSync(dirname(outPath), { recursive: true });
  const content = `/**
 * 由 assemble-webview-html.mjs 生成，禁止手改。
 * 重新生成：npm run assemble:webview-html -w @novel-master/mobile
 */
export const ${exportName} = \`${toTsStringLiteral(html)}\`;
`;
  writeFileSync(outPath, content, 'utf8');
  return outPath;
}

function main() {
  const constantsPath = writeGeneratedConstants();
  const transcriptCss = injectCss(
    read('src/web/chat-transcript/shell/transcript.css'),
    CHAT_TRANSCRIPT_RICH_CSS,
  );
  const transcriptHtml = assembleHtml(
    read('src/web/chat-transcript/shell/transcript.html'),
    transcriptCss,
    concatTranscriptBoot(),
  );
  const documentCss = injectCss(
    read('src/web/rich-document/shell/document.css'),
    RICH_DOCUMENT_RICH_CSS,
  );
  const documentHtml = assembleHtml(
    read('src/web/rich-document/shell/document.html'),
    documentCss,
    concatDocumentBoot(),
  );

  const tPath = writeGeneratedTs(
    'src/web/chat-transcript/transcript-html.generated.ts',
    'CHAT_TRANSCRIPT_HTML',
    transcriptHtml,
  );
  const dPath = writeGeneratedTs(
    'src/web/rich-document/document-html.generated.ts',
    'RICH_DOCUMENT_HTML',
    documentHtml,
  );

  const rel = (p) => relative(repoRoot, p).replace(/\\/g, '/');
  console.log(`已生成 ${rel(constantsPath)}`);
  console.log(`已生成 ${rel(tPath)} (${transcriptHtml.length} chars)`);
  console.log(`已生成 ${rel(dPath)} (${documentHtml.length} chars)`);
}

main();
