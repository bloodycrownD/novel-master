/**
 * T-BB-06：chat-transcript 契约测迁移矩阵 — 读 webview-dist 产物（pretest 已 build:webview）。
 */
import {
  ANCHORED_MENU_CHAR_WIDTH_EST,
  ANCHORED_MENU_GAP,
  ANCHORED_MENU_H_PADDING,
  ANCHORED_MENU_ITEM_LAYOUT_HEIGHT,
  ANCHORED_MENU_ITEM_MIN_HEIGHT,
  ANCHORED_MENU_MAX_HEIGHT_CAP,
  ANCHORED_MENU_MAX_WIDTH,
  ANCHORED_MENU_MIN_WIDTH,
  ANCHORED_MENU_SCREEN_MARGIN,
  ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT,
  LONG_PRESS_MOVE_TOLERANCE_PX,
  MENU_OPEN_GRACE_MS,
  MESSAGE_ACTION_MENU_ITEM_COUNT,
  NEAR_BOTTOM_THRESHOLD_PX,
} from '../src/web/shared/constants';
import { readWebViewDistFile } from './helpers/read-webview-dist';

function bootScript(): string {
  return readWebViewDistFile('chat-transcript', 'app.js');
}

function indexHtml(): string {
  return readWebViewDistFile('chat-transcript', 'index.html');
}

function appCss(): string {
  return readWebViewDistFile('chat-transcript', 'app.css');
}

describe('chat-transcript WebView boot (T-BB-06 / dist)', () => {
  it('T-BR-ASM-01: script parses and has readyState fallback', () => {
    const script = bootScript();
    expect(script).toContain('readyState === "loading"');
    expect(script).toContain('bootTranscript');
    expect(() => {
      // eslint-disable-next-line no-new-func -- 语法守护：boot IIFE 不可损坏
      new Function(script);
    }).not.toThrow();
  });

  it('T-BR-ASM-03: shell has scroller/rows; relative app.js/app.css（无 BASE_URL）', () => {
    const html = indexHtml();
    expect(html).toContain('id="scroller"');
    expect(html).toContain('id="rows"');
    expect(html).toContain('./app.js');
    expect(html).toContain('./app.css');
    expect(html).toContain('<script src="./app.js"');
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain('https://novel-master.local/');
  });

  it('T-BR-ASM-04: ready post and bootTranscript present', () => {
    const script = bootScript();
    expect(script).toContain('post("ready"');
    expect(script).toContain('bootTranscript');
  });

  it('T-BR-CT-01: menu overlay / grace / layoutContextMenu contracts', () => {
    const script = bootScript();
    expect(script).toContain('menuOverlayHandler');
    expect(script).toContain('handleMenuOverlayEvent');
    expect(script).toContain(
      'document.addEventListener("click", state.menuOverlayHandler, true)',
    );
    expect(script).toContain(`MENU_OPEN_GRACE_MS = ${MENU_OPEN_GRACE_MS}`);
    expect(script).toContain('state.menuOpenedAt');
    expect(script).toContain('layoutContextMenu');
    expect(script).toContain('scrollable');
    expect(script).toContain('resolveMenuAnchor');
    expect(script).toContain('touch.clientX');
    expect(script).toContain('querySelector(".bubble")');
    expect(script).toContain('menu.items.length <= MESSAGE_ACTION_MENU_ITEM_COUNT');
    expect(script).toContain('measuredHeight');
    expect(script).toContain('onMessagePointerMove');
    expect(script).toContain('shouldCancelLongPressForMove');
    expect(script).toContain('decodeLiteralHtmlEntities');
    expect(script).toContain('richToggledOn');
    expect(script).toContain('attachMenuNativeTextBlock');
    expect(script).toContain('menu-open');
    expect(script).toContain('touchH');
  });

  it('T-BR-CT-02: shouldCancelLongPressForMove has function body or inline hypot', () => {
    const script = bootScript();
    const hasFnBody = /function\s+shouldCancelLongPressForMove\s*\(/.test(script);
    const hasInlineHypot =
      /Math\.hypot\s*\(\s*dx\s*,\s*dy\s*\)/.test(script) ||
      /Math\.hypot\s*\(\s*deltaX\s*,\s*deltaY\s*\)/.test(script);
    expect(hasFnBody || hasInlineHypot).toBe(true);
    if (hasFnBody) {
      expect(script).toMatch(
        /function\s+shouldCancelLongPressForMove\s*\([^)]*\)\s*\{[\s\S]*?Math\.hypot/,
      );
    }
  });

  it('T-BR-CT-03: stream waiting-first / incremental / rich+noHtml', () => {
    const script = bootScript();
    expect(script).toContain('stream--waiting-first');
    expect(script).toContain('stream-waiting-indicator');
    expect(script).toContain('renderStreamWaitingFirstRow');
    expect(script).toContain('getStreamTailPhase');
    expect(script).toContain('streamHasContent');
    expect(script).toContain('stream--waiting-first');
    expect(script).toContain('querySelector(".bubble")');
    expect(script).toContain('renderStreamBubbleInner');
    expect(script).toContain('renderAssistantBubbleInner');
    expect(script).toContain('ensureStreamTextBody');
    expect(script).toContain('data-text-shell');
    expect(script).toContain('setStreamToolInvokingDom');
    expect(script).toContain('streamThinkingHtml');
    expect(script).toContain('updateStreamBubble');
    expect(script).toContain('p.html');
    expect(script).toContain('state.stream.textHtml = ""');
    expect(script).toContain('state.stream.thinkingHtml = ""');
    expect(script).toContain('body.innerHTML = html');
    expect(script).toContain('renderStreamingMarkdown');
    expect(script).toContain('scheduleStreamRichUpgrade');
    expect(script).toContain('appendStreamDeltaIncremental');
    expect(script).toContain('applyStreamBatch');
    expect(script).toContain('case "streamBatch"');
    expect(script).toContain('if (!incremental && kind !== "text") {');
    expect(script).toContain('updateStreamBubble(tail);');
    expect(script).toContain('if (!tail) {');
    expect(script).toContain('renderRows();');
    expect(script).toContain('if (state.flags.richText && !html) {');
    expect(script).toContain('} else if (kind === "text") {');
    expect(script).toContain('const streamTextBody = ensureStreamTextBody(bubble);');
    expect(script).toContain(
      'streamTextBody.insertAdjacentHTML("beforeend", escapeHtml(delta));',
    );
  });

  it('T-BR-CT-04: streamCommit / promote tail', () => {
    const script = bootScript();
    expect(script).toContain('case "streamCommit":');
    expect(script).toContain('function applyStreamCommit(payload)');
    expect(script).toContain('function promoteStreamTailToRow(row)');
    expect(script).toContain('state.rows = state.rows.concat(toAppend)');
  });

  it('T-BR-CT-05: vfs tool path normalize symbols', () => {
    const script = bootScript();
    expect(script).toContain('resolveVfsToolFilePath');
    expect(script).toContain('resolveLogicalPathForToolCard');
    expect(script).toContain("return normalizePathForToolCard(\"/\" + trimmed);");
  });

  it('T-BR-CT-06: bubble--fill-width / data-text-shell', () => {
    const script = bootScript();
    expect(script).toContain('bubble--fill-width');
    expect(script).toContain('hasThinking');
    expect(script).toContain('hasTools');
    expect(script).toContain('} else if (hasThinking) {');
    expect(script).toContain(
      'const richShellBubble = state.flags.richText && textHtml ? " rich" : "";',
    );
    expect(script).toContain(
      `html += '<div class="bubble-body' + richShellBubble + '" data-text-shell="1"></div>';`,
    );
    expect(script).toContain(
      'const showIdleBar = getStreamTailPhase() === "idle-after-content"',
    );
  });

  it('T-BR-CT-07: no parseUserVfsAction / user-vfs-action regression', () => {
    const script = bootScript();
    expect(script).not.toContain('user-vfs-action');
    expect(script).not.toContain('parseUserVfsAction');
  });

  it('T-BR-CSS-01: rich list padding in app.css', () => {
    const css = appCss();
    expect(css).toContain('.bubble.rich ol');
    expect(css).toContain('.bubble.rich ul');
    expect(css).toContain('padding-left: 1.5em');
    expect(css).toContain(
      'outside markers stay inside the content area',
    );
  });

  it('T-BR-SYNC-01…14: boot constants match TS sources', () => {
    const script = bootScript();
    expect(script).toContain(
      `var NEAR_BOTTOM_THRESHOLD_PX = ${NEAR_BOTTOM_THRESHOLD_PX};`,
    );
    expect(script).toContain('var NEAR_BOTTOM = NEAR_BOTTOM_THRESHOLD_PX;');
    expect(script).toContain(`var MENU_OPEN_GRACE_MS = ${MENU_OPEN_GRACE_MS};`);
    expect(script).toContain(
      `var LONG_PRESS_MOVE_TOLERANCE_PX = ${LONG_PRESS_MOVE_TOLERANCE_PX};`,
    );
    expect(script).toContain(`var ANCHORED_MENU_GAP = ${ANCHORED_MENU_GAP};`);
    expect(script).toContain(
      `var ANCHORED_MENU_SCREEN_MARGIN = ${ANCHORED_MENU_SCREEN_MARGIN};`,
    );
    expect(script).toContain(
      `var ANCHORED_MENU_ITEM_MIN_HEIGHT = ${ANCHORED_MENU_ITEM_MIN_HEIGHT};`,
    );
    expect(script).toContain(
      `var ANCHORED_MENU_ITEM_LAYOUT_HEIGHT = ${ANCHORED_MENU_ITEM_LAYOUT_HEIGHT};`,
    );
    expect(script).toContain(
      `var ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT = ${ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT};`,
    );
    expect(script).toContain(
      `var ANCHORED_MENU_MAX_HEIGHT_CAP = ${ANCHORED_MENU_MAX_HEIGHT_CAP};`,
    );
    expect(script).toContain(`var ANCHORED_MENU_MIN_WIDTH = ${ANCHORED_MENU_MIN_WIDTH};`);
    expect(script).toContain(`var ANCHORED_MENU_MAX_WIDTH = ${ANCHORED_MENU_MAX_WIDTH};`);
    expect(script).toContain(
      `var ANCHORED_MENU_H_PADDING = ${ANCHORED_MENU_H_PADDING};`,
    );
    expect(script).toContain(
      `var ANCHORED_MENU_CHAR_WIDTH_EST = ${ANCHORED_MENU_CHAR_WIDTH_EST};`,
    );
    expect(script).toContain(
      `var MESSAGE_ACTION_MENU_ITEM_COUNT = ${MESSAGE_ACTION_MENU_ITEM_COUNT};`,
    );
  });
});
