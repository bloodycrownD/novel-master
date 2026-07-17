/**
 * 由 assemble-webview-html.mjs 生成，禁止手改。
 * 重新生成：npm run assemble:webview-html -w @novel-master/mobile
 */
export const CHAT_TRANSCRIPT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; background: var(--bg, #fff); color: var(--text, #111); font-family: system-ui, -apple-system, sans-serif; }
#scroller { height: 100%; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; overflow-anchor: none; }
#rows { display: flex; flex-direction: column; min-height: 100%; justify-content: flex-end; padding: 8px 12px 12px; gap: 8px; }
.row { display: flex; width: 100%; flex-direction: column; }
.row.user { align-items: flex-end; }
.row.assistant, .row.stream, .row.tool { align-items: flex-start; }
.bubble { max-width: 85%; padding: 10px 14px; border-radius: 16px; white-space: pre-wrap; word-break: break-word; font-size: 15px; line-height: 1.4; }
.row.user .bubble { background: var(--primary, #007aff); color: #fff; }
/* 含附件：仍用用户蓝气泡，附件组嵌在同条消息内；卡片用半透明玻璃态适配蓝底 */
.row.user .bubble.bubble--user-compose {
  width: 85%; max-width: 85%; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 0;
}
.row.user .bubble.bubble--user-compose .tool-group-title,
.row.user .bubble.bubble--user-compose .tool-group-chevron {
  color: rgba(255, 255, 255, 0.85);
}
.row.user .bubble.bubble--user-compose .tool-group-divided {
  border-bottom-color: rgba(255, 255, 255, 0.35);
}
.row.user .bubble.bubble--user-compose .attach-group-divided-above {
  padding-top: 8px; margin-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.35);
}
.row.user .bubble.bubble--user-compose .attach-card.tool-card {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.28);
  color: #fff;
}
.row.user .bubble.bubble--user-compose .attach-card .tool-name {
  color: #fff;
}
.row.user .bubble.bubble--user-compose .attach-card .tool-status,
.row.user .bubble.bubble--user-compose .attach-card .tool-status.success {
  color: rgba(255, 255, 255, 0.8);
}
.row.user .bubble.bubble--user-compose .bubble-body {
  color: #fff; white-space: pre-wrap; word-break: break-word;
}
.row.assistant .bubble, .row.stream .bubble { background: var(--surface, #f2f2f7); color: var(--text, #111); }
.row.hidden .bubble { opacity: 0.45; }
.bubble .thinking-section { margin: 0; padding: 0; border: none; background: transparent; max-width: none; }
.thinking-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent; }
.thinking-title { font-size: 12px; font-weight: 600; color: var(--text-secondary, #666); }
.thinking-chevron { font-size: 10px; color: var(--text-secondary, #888); }
.thinking-body { margin-top: 6px; font-size: 13px; line-height: 1.45; color: var(--text-secondary, #666); white-space: pre-wrap; word-break: break-word; }
.thinking-body.rich { white-space: normal; }
.thinking-body-divided { padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid var(--border, #e5e5ea); }
.bubble-body { font-size: 15px; line-height: 1.4; color: inherit; white-space: pre-wrap; word-break: break-word; }
.bubble .tool-group-section { margin: 0; padding: 0; border: none; background: transparent; max-width: none; }
.tool-group-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent; }
.tool-group-title { font-size: 12px; font-weight: 600; color: var(--text-secondary, #666); }
.tool-group-chevron { font-size: 10px; color: var(--text-secondary, #888); }
.tool-group-items { margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
.tool-group-divided { padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid var(--border, #e5e5ea); }
.tool-card { max-width: 92%; width: 100%; margin: 2px 0; padding: 12px; border-radius: 8px; border: 1px solid var(--border, #e5e5ea); background: var(--surface, #f2f2f7); }
.bubble .tool-group-item.tool-card { max-width: none; width: 100%; margin: 0; background: var(--bg, #fff); }
.tool-card.tappable { border-color: var(--primary, #007aff); cursor: pointer; -webkit-tap-highlight-color: transparent; }
.tool-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tool-name { flex: 1; font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-status { font-size: 12px; font-weight: 500; }
.tool-status.success { color: var(--primary, #007aff); }
.tool-status.error { color: #ff3b30; }
.tool-status.pending { color: var(--text-secondary, #888); }
.tool-status.interrupted { color: var(--text-secondary, #888); }
.tool-phase-bar { margin-top: 6px; font-size: 13px; font-weight: 500; color: var(--text-secondary, #888); }
.tool-invoking-bar { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border, #e5e5ea); font-size: 12px; font-weight: 600; color: var(--primary, #007aff); }
.tool-invoking-dot { flex-shrink: 0; width: 8px; height: 8px; border-radius: 4px; background: var(--primary, #007aff); animation: tool-invoking-pulse 1.2s ease-in-out infinite; }
.row.stream.stream--waiting-first { align-items: flex-start; width: 100%; }
.stream-waiting-indicator { display: flex; align-items: center; gap: 8px; padding: 6px 2px; font-size: 12px; font-weight: 600; color: var(--primary, #007aff); }
.stream--waiting-first .stream-waiting-indicator { border-top: none; margin-top: 0; padding-top: 0; }
@keyframes tool-invoking-pulse { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1); } }
.tool-summary { margin-top: 6px; font-size: 13px; color: var(--text-secondary, #666); white-space: pre-wrap; word-break: break-word; }
.tool-open-hint { margin-top: 8px; font-size: 12px; font-weight: 500; color: var(--primary, #007aff); }
.load-older { align-self: center; padding: 10px 16px; font-size: 14px; color: var(--primary, #007aff); background: transparent; border: none; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.bubble.rich, .bubble-body.rich, .thinking-body.rich { white-space: normal; overflow-wrap: anywhere; }
    .bubble.rich p, .bubble-body.rich p, .thinking-body.rich p { margin: 0.35em 0; }
    .bubble.rich p, .bubble-body.rich p, .thinking-body.rich p:first-child { margin-top: 0; }
    .bubble.rich p, .bubble-body.rich p, .thinking-body.rich p:last-child { margin-bottom: 0; }
    /* Global reset strips list padding; indent so outside markers stay inside the content area. */
    .bubble.rich ol, .bubble-body.rich ol, .thinking-body.rich ol, .bubble.rich ul, .bubble-body.rich ul, .thinking-body.rich ul { margin: 0.35em 0; padding-left: 1.5em; list-style-position: outside; }
    .bubble.rich ul ul, .bubble.rich ol ol, .bubble.rich ul ol, .bubble.rich ol ul, .bubble-body.rich ul ul, .bubble-body.rich ol ol, .bubble-body.rich ul ol, .bubble-body.rich ol ul, .thinking-body.rich ul ul, .thinking-body.rich ol ol, .thinking-body.rich ul ol, .thinking-body.rich ol ul { margin-top: 0.2em; margin-bottom: 0; padding-left: 1.25em; }
    .bubble.rich li, .bubble-body.rich li, .thinking-body.rich li { margin: 0.15em 0; }
    .bubble.rich li + li, .bubble-body.rich li + li, .thinking-body.rich li + li { margin-top: 0.25em; }
    .bubble.rich li > p, .bubble-body.rich li > p, .thinking-body.rich li > p { margin: 0; }
    .bubble.rich strong, .bubble-body.rich strong, .thinking-body.rich strong, .bubble.rich b, .bubble-body.rich b, .thinking-body.rich b { font-weight: 600; }
    .bubble.rich hr, .bubble-body.rich hr, .thinking-body.rich hr {
      border: none;
      border-top: 1px solid var(--border, #e5e5ea);
      margin: 0.5em 0;
      opacity: 0.85;
    }
    .bubble.rich blockquote, .bubble-body.rich blockquote, .thinking-body.rich blockquote {
      margin: 0.35em 0; padding-left: 0.75em;
      border-left: 3px solid var(--border, #e5e5ea);
    }
    .bubble.rich h1, .bubble-body.rich h1, .thinking-body.rich h1 { font-size: 1.15em; font-weight: 700; margin: 0.4em 0 0.3em; }
    .bubble.rich h2, .bubble-body.rich h2, .thinking-body.rich h2 { font-size: 1.08em; font-weight: 700; margin: 0.38em 0 0.28em; }
    .bubble.rich h3, .bubble-body.rich h3, .thinking-body.rich h3 { font-size: 1em; font-weight: 700; margin: 0.35em 0; }
    .bubble.rich code, .bubble-body.rich code, .thinking-body.rich code { font-family: ui-monospace, monospace; font-size: 0.9em; background: rgba(0,0,0,0.06); padding: 0.1em 0.25em; border-radius: 4px; }
    .bubble.rich pre, .bubble-body.rich pre, .thinking-body.rich pre { overflow-x: auto; margin: 0.35em 0; }
    .bubble.rich a, .bubble-body.rich a, .thinking-body.rich a { color: var(--primary, #007aff); }
.bubble-body.rich { white-space: normal; }
.row.assistant .bubble.bubble--fill-width { width: 85%; max-width: 85%; box-sizing: border-box; }
.row.user.vfs-turn-row .bubble.bubble--fill-width { width: 85%; max-width: 85%; box-sizing: border-box; }
.empty-state { align-self: center; margin-top: 32px; padding: 0 24px; text-align: center; color: var(--text-secondary, #666); font-size: 14px; }
.menu-backdrop { position: fixed; inset: 0; z-index: 9998; background: rgba(0,0,0,0.35); -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.context-menu { position: fixed; z-index: 9999; display: flex; flex-direction: column; flex-shrink: 0; height: fit-content; min-width: 132px; max-width: 200px; border-radius: 10px; border: 1px solid var(--border, #e5e5ea); background: var(--surface, #f2f2f7); overflow-x: hidden; overflow-y: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.15); -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: manipulation; }
.context-menu.scrollable { overflow-y: auto; -webkit-overflow-scrolling: touch; }
.menu-item { flex: 0 0 auto; display: block; width: 100%; min-height: 44px; padding: 0 12px; border: none; border-bottom: 1px solid var(--border, #e5e5ea); background: transparent; color: var(--text, #111); font-size: 15px; text-align: center; cursor: pointer; -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: manipulation; }
body.menu-open { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.menu-item:last-child { border-bottom: none; }
.row.user.vfs-turn-row .vfs-turn-bubble {
  background: var(--surface, #f2f2f7);
  color: var(--text, #111);
  text-align: left;
}
.row.user.vfs-turn-row .tool-group-title { color: var(--primary, #007aff); }
.menu-item.danger { color: #ff3b30; }

  </style>
</head>
<body>
  <div id="scroller"><div id="rows"></div></div>
  <script>(function () {
/**
 * 由 assemble-webview-html.mjs 从 TS 源抽取生成，禁止手改。
 * 重新生成：npm run assemble:webview-html -w @novel-master/mobile
 */
var NEAR_BOTTOM = 80;
var MENU_OPEN_GRACE_MS = 400;
var LONG_PRESS_MOVE_TOLERANCE_PX = 10;
var ANCHORED_MENU_GAP = 8;
var ANCHORED_MENU_SCREEN_MARGIN = 12;
var ANCHORED_MENU_ITEM_MIN_HEIGHT = 44;
var ANCHORED_MENU_ITEM_LAYOUT_HEIGHT = 48;
var ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT = 32;
var ANCHORED_MENU_MAX_HEIGHT_CAP = 360;
var ANCHORED_MENU_MIN_WIDTH = 132;
var ANCHORED_MENU_MAX_WIDTH = 200;
var ANCHORED_MENU_H_PADDING = 32;
var ANCHORED_MENU_CHAR_WIDTH_EST = 14;
var MESSAGE_ACTION_MENU_ITEM_COUNT = 5;

function decodeLiteralHtmlEntities(text) {
    var current = String(text || '');
    var previous = '';
    var pass = 0;
    while (current !== previous && pass < 3) {
      previous = current;
      current = current
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#(?:0*34|x0*22);/gi, '"')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&apos;/gi, "'")
        .replace(/&#(?:0*39|x0*27);/gi, "'");
      pass += 1;
    }
    return current;
  }

/**
 * HTML 转义工具（供 stream-markdown 与行渲染共用）。
 */
  function escapeHtml(s) {
    return escapeHtmlRaw(decodeLiteralHtmlEntities(s));
  }

  function escapeHtmlRaw(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

var STREAM_RICH_UPGRADE_MS = 350;
  var streamRichUpgrade = {
    timer: null,
    kinds: { text: false, thinking: false },
    plainMode: { text: true, thinking: true }
  };

  function renderStreamingInline(s) {
    var escaped = escapeHtmlRaw(s);
    return escaped
      .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
      .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
      .replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  }

  function renderStreamingMarkdown(text) {
    var normalized = decodeLiteralHtmlEntities(String(text || '').trim());
    if (!normalized) return '';
    var lines = normalized.split(/\\n/);
    var html = '';
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var bullet = /^\\s*[-*+]\\s+(.+)$/.exec(line);
      var ordered = /^\\s*\\d+\\.\\s+(.+)$/.exec(line);
      if (bullet) {
        if (!inList) { html += '<ul>'; inList = 'ul'; }
        else if (inList === 'ol') { html += '</ol><ul>'; inList = 'ul'; }
        html += '<li>' + renderStreamingInline(bullet[1]) + '</li>';
        continue;
      }
      if (ordered) {
        if (!inList) { html += '<ol>'; inList = 'ol'; }
        else if (inList === 'ul') { html += '</ul><ol>'; inList = 'ol'; }
        html += '<li>' + renderStreamingInline(ordered[1]) + '</li>';
        continue;
      }
      if (inList) {
        html += inList === 'ul' ? '</ul>' : '</ol>';
        inList = false;
      }
      if (line.trim() === '') continue;
      html += '<p>' + renderStreamingInline(line) + '</p>';
    }
    if (inList) html += inList === 'ul' ? '</ul>' : '</ol>';
    return html;
  }

  function clearStreamRichUpgrade() {
    if (streamRichUpgrade.timer != null) {
      clearTimeout(streamRichUpgrade.timer);
      streamRichUpgrade.timer = null;
    }
    streamRichUpgrade.kinds.text = false;
    streamRichUpgrade.kinds.thinking = false;
    streamRichUpgrade.plainMode.text = true;
    streamRichUpgrade.plainMode.thinking = true;
  }

  function paintStreamRichKind(tail, kind) {
    var bubble = tail.querySelector('.bubble');
    if (!bubble) return;
    if (kind === 'thinking') {
      var section = bubble.querySelector('[data-thinking-key="stream:thinking"]');
      var body = section ? section.querySelector('.thinking-body') : null;
      if (!body) return;
      var thinkingHtml = renderStreamingMarkdown(state.stream.thinking);
      if (!thinkingHtml) return;
      body.innerHTML = thinkingHtml;
      setStreamBodyRichClass(body, true);
      state.stream.thinkingHtml = thinkingHtml;
    } else {
      var textBody = ensureStreamTextBody(bubble);
      var textHtml = renderStreamingMarkdown(state.stream.text);
      if (!textHtml) return;
      textBody.innerHTML = textHtml;
      setStreamBodyRichClass(textBody, true);
      state.stream.textHtml = textHtml;
    }
    bubble.className = 'bubble assistant' + assistantBubbleExtraClasses(
      state.stream.textHtml,
      [],
      state.stream.text,
      state.stream.thinking,
      undefined
    );
  }

  function flushStreamRichUpgrade() {
    streamRichUpgrade.timer = null;
    var tail = document.getElementById('stream-tail');
    if (!tail) return;
    var paintStart = Date.now();
    if (streamRichUpgrade.kinds.text) {
      paintStreamRichKind(tail, 'text');
      streamRichUpgrade.kinds.text = false;
      streamRichUpgrade.plainMode.text = false;
    }
    if (streamRichUpgrade.kinds.thinking) {
      paintStreamRichKind(tail, 'thinking');
      streamRichUpgrade.kinds.thinking = false;
      streamRichUpgrade.plainMode.thinking = false;
    }
    void paintStart;
    scheduleStickIfNearBottom();
  }

  function scheduleStreamRichUpgrade(kind) {
    if (!state.flags.richText) return;
    streamRichUpgrade.kinds[kind] = true;
    if (streamRichUpgrade.timer != null) return;
    streamRichUpgrade.timer = setTimeout(flushStreamRichUpgrade, STREAM_RICH_UPGRADE_MS);
  }

/**
 * chat-transcript boot 共享状态与版本常量。
 */
  var SCHEMA_V = 2;
  var BRIDGE_V = 1;
  var VFS_FILE_TOOLS = { read: 1, write: 1, edit: 1 };
  var state = {
    ready: false,
    nearBottom: true,
    sessionKey: '',
    rows: [],
    hasMore: false,
    stream: { text: '', thinking: '', textHtml: '', thinkingHtml: '', toolInvoking: false },
    flags: { richText: false, menuDisabled: false },
    menu: null,
    menuOverlayHandler: null,
    menuNativeTextBlockHandler: null,
    thinkingExpanded: {},
    toolGroupExpanded: {},
    attachGroupExpanded: {},
    scrollRaf: null,
    loadOlderArmed: true,
    longPressTimer: null,
    longPressTarget: null,
    menuOpenedAt: 0,
  };

function normalizePathForToolCard(path) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('invalid path');
    }
    var normalized = path.replace(/\\\\/g, '/');
    if (normalized.charAt(0) !== '/') {
      throw new Error('invalid path');
    }
    var segments = normalized.split('/');
    var stack = [];
    for (var si = 0; si < segments.length; si++) {
      var segment = segments[si];
      if (segment === '' || segment === '.') {
        continue;
      }
      if (segment === '..') {
        if (stack.length === 0) {
          throw new Error('path escapes above root');
        }
        stack.pop();
        continue;
      }
      stack.push(segment);
    }
    if (stack.length === 0) {
      return '/';
    }
    return '/' + stack.join('/');
  }

  function resolveLogicalPathForToolCard(input) {
    var trimmed = String(input).replace(/^\\s+|\\s+$/g, '');
    if (trimmed.length === 0) {
      throw new Error('invalid path');
    }
    if (trimmed.charAt(0) === '/') {
      return normalizePathForToolCard(trimmed);
    }
    return normalizePathForToolCard('/' + trimmed);
  }

  function resolveVfsToolFilePath(name, input) {
    if (name.indexOf('vfs.') === 0) name = name.slice(4);
    if (!VFS_FILE_TOOLS[name]) return null;
    var raw = input && input.path;
    if (typeof raw !== 'string') return null;
    try {
      return resolveLogicalPathForToolCard(raw);
    } catch (e) {
      return null;
    }
  }

  function vfsToolFilePath(name, input) {
    return resolveVfsToolFilePath(name, input);
  }

/**
 * 滚动锚点、贴底与加载更早消息。
 */
var SCROLL_TOP_LOAD_OLDER = 24;
  function offsetFromBottom(el) {
    return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
  }

  function isNearBottom(el) {
    return offsetFromBottom(el) <= NEAR_BOTTOM;
  }

  function stickToBottom(el) {
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    state.nearBottom = true;
  }

  /** Tail shrink (rollback): prevScrollTop may exceed new max — clamp to avoid bubble jump. */
  function clampScrollTop(el, prevScrollTop) {
    var maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.min(prevScrollTop, maxScroll);
  }

  function scheduleStickIfNearBottom() {
    if (!state.nearBottom) return;
    if (state.scrollRaf != null) return;
    state.scrollRaf = requestAnimationFrame(function () {
      state.scrollRaf = null;
      var scroller = document.getElementById('scroller');
      if (scroller) stickToBottom(scroller);
    });
  }

  function emitScrollSnapshot() {
    var scroller = document.getElementById('scroller');
    if (!scroller) return;
    var off = offsetFromBottom(scroller);
    var near = off <= NEAR_BOTTOM;
    state.nearBottom = near;
    post('scrollSnapshot', {
      schemaVersion: SCHEMA_V,
      offsetY: off,
      nearBottom: near,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    });
  }

  var scrollTimer = null;
  function requestLoadOlder() {
    if (!state.hasMore || !state.loadOlderArmed) return;
    state.loadOlderArmed = false;
    post('loadOlder', {});
  }

  function onScroll() {
    var scroller = document.getElementById('scroller');
    if (!scroller) return;
    if (state.longPressTimer != null || state.longPressTarget != null) {
      clearLongPress();
    }
    state.nearBottom = isNearBottom(scroller);
    if (scroller.scrollTop <= SCROLL_TOP_LOAD_OLDER) {
      requestLoadOlder();
    }
    if (scrollTimer != null) return;
    scrollTimer = setTimeout(function () {
      scrollTimer = null;
      emitScrollSnapshot();
    }, 100);
  }

/**
 * 工具调用摘要、状态标签与工具组 HTML 渲染。
 */
function summarizeToolInput(name, input) {
    var path = input && (input.path || input.dir || input.from);
    if (typeof path === 'string') return path;
    var keys = input ? Object.keys(input) : [];
    if (keys.length === 0) return '';
    try {
      var raw = JSON.stringify(input);
      return raw.length > 120 ? raw.slice(0, 117) + '…' : raw;
    } catch (e) {
      return keys.join(', ');
    }
  }

  function toolCallSummary(row) {
    if (row.status === 'error' && row.summary) {
      return row.summary;
    }
    var fromInput = summarizeToolInput(row.name, row.input || {});
    if (fromInput) return fromInput;
    if (row.resultContent) {
      var t = String(row.resultContent).trim();
      return t.length > 120 ? t.slice(0, 117) + '…' : t;
    }
    return '';
  }

  function toolStatusLabel(status) {
    if (status === 'success') return '成功';
    if (status === 'error') return '失败';
    if (status === 'pending') return '执行中';
    if (status === 'interrupted') return '已中断';
    return '';
  }

  function renderToolInvokingBar() {
    return (
      '<div class="tool-invoking-bar">' +
      '<span class="tool-invoking-dot" aria-hidden="true"></span>' +
      '<span class="tool-invoking-label">生成中</span></div>'
    );
  }

  function renderToolGroupItem(tool) {
    var filePath = vfsToolFilePath(tool.name, tool.input || {});
    var canOpen = filePath != null;
    var summary = toolCallSummary(tool);
    var statusClass = tool.status === 'error'
      ? 'error'
      : (tool.status === 'pending'
        ? 'pending'
        : (tool.status === 'interrupted' ? 'interrupted' : 'success'));
    var statusInner = toolStatusLabel(tool.status);
    var html =
      '<div class="tool-group-item tool-card' + (canOpen ? ' tappable' : '') + '"' +
      (canOpen ? ' data-action="open-tool-file" data-path="' + escapeHtml(filePath) + '"' : '') +
      '>' +
      '<div class="tool-header">' +
      '<span class="tool-name">' + escapeHtml(tool.name || '') + '</span>' +
      '<span class="tool-status ' + statusClass + '">' + statusInner + '</span>' +
      '</div>';
    if (summary) {
      html += '<div class="tool-summary">' + escapeHtml(summary) + '</div>';
    }
    if (canOpen) {
      html += '<div class="tool-open-hint">点击查看 · 聊天工作区</div>';
    }
    html += '</div>';
    return html;
  }

  function renderToolGroupSection(tools, key, expanded, showDividerBelow, options) {
    if (!tools || tools.length === 0) return '';
    var isExpanded = expanded;
    var chevron = isExpanded ? '▼' : '▶';
    var divided = isExpanded && showDividerBelow ? ' tool-group-divided' : '';
    var groupTitle =
      options && options.groupTitle
        ? options.groupTitle
        : '工具调用 (' + tools.length + ')';
    var html =
      '<div class="tool-group-section' + divided + '" data-tool-group-key="' + escapeHtml(key) + '">' +
      '<div class="tool-group-header" data-action="toggle-tool-group" data-tool-group-key="' + escapeHtml(key) + '">' +
      '<span class="tool-group-title">' + escapeHtml(groupTitle) + '</span>' +
      '<span class="tool-group-chevron">' + chevron + '</span></div>';
    if (isExpanded) {
      html += '<div class="tool-group-items">';
      for (var ti = 0; ti < tools.length; ti++) {
        html += renderToolGroupItem(tools[ti]);
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

/**
 * 消息行 / 思考 / 附件 / 助手气泡 / 用户 VFS 行渲染。
 */
  function thinkingBodyInner(text, thinkingHtml) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return '';
    if (state.flags.richText && thinkingHtml) {
      return thinkingHtml;
    }
    return escapeHtml(trimmed);
  }

  function renderThinkingSection(text, key, expanded, thinkingHtml, showDividerBelow) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return '';
    var chevron = expanded ? '▼' : '▶';
    var richClass = state.flags.richText && thinkingHtml ? ' rich' : '';
    var bodyClass = 'thinking-body' + richClass;
    if (expanded && showDividerBelow) {
      bodyClass += ' thinking-body-divided';
    }
    var body = expanded
      ? '<div class="' + bodyClass + '">' + thinkingBodyInner(text, thinkingHtml) + '</div>'
      : '';
    return (
      '<div class="thinking-section" data-thinking-key="' + escapeHtml(key) + '">' +
      '<div class="thinking-header" data-action="toggle-thinking" data-thinking-key="' + escapeHtml(key) + '">' +
      '<span class="thinking-title">思考过程</span>' +
      '<span class="thinking-chevron">' + chevron + '</span></div>' + body + '</div>'
    );
  }

  function attachmentChipLabel(a) {
    if (a.source === 'user_ops') {
      return a.name || '';
    }
    var path = a.path || a.name || '';
    if (a.type === 'dir') {
      return '📁' + path;
    }
    return '📄' + path;
  }

  function attachmentSourceLabel(a) {
    if (a.source === 'workplace') {
      return '工作区';
    }
    if (a.source === 'user_ops') {
      return '';
    }
    return a.type === 'dir' ? '目录' : '文件';
  }

  /** 对齐工具调用组：可折叠 header + surface 卡片列表。 */
  function renderAttachGroupSection(attachments, key, expanded, showDividerAbove) {
    if (!attachments || attachments.length === 0) {
      return '';
    }
    var isExpanded = !!expanded;
    var chevron = isExpanded ? '▼' : '▶';
    var divided = showDividerAbove ? ' attach-group-divided-above' : '';
    var html =
      '<div class="tool-group-section attach-group-section' +
      divided +
      '" data-attach-group-key="' +
      escapeHtml(key) +
      '">' +
      '<div class="tool-group-header" data-action="toggle-attach-group" data-attach-group-key="' +
      escapeHtml(key) +
      '">' +
      '<span class="tool-group-title">消息附件 (' +
      attachments.length +
      ')</span>' +
      '<span class="tool-group-chevron">' +
      chevron +
      '</span></div>';
    if (isExpanded) {
      html += '<div class="tool-group-items">';
      for (var ai = 0; ai < attachments.length; ai++) {
        var a = attachments[ai];
        html +=
          '<div class="tool-group-item tool-card attach-card">' +
          '<div class="tool-header">' +
          '<span class="tool-name">' +
          escapeHtml(attachmentChipLabel(a)) +
          '</span>' +
          (attachmentSourceLabel(a)
            ? '<span class="tool-status success">' +
              escapeHtml(attachmentSourceLabel(a)) +
              '</span>'
            : '') +
          '</div></div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderAssistantBubbleInner(
    text,
    textHtml,
    thinking,
    thinkingKey,
    thinkingExpanded,
    thinkingHtml,
    tools,
    toolGroupKey,
    toolGroupExpanded,
    showToolInvoking
  ) {
    var html = '';
    var hasThinking = !!(thinking && String(thinking).trim());
    var hasTools = !!(tools && tools.length > 0);
    var hasInvoking = !!showToolInvoking;
    var hasText = !!(text && String(text).trim());
    if (hasThinking) {
      html += renderThinkingSection(
        thinking,
        thinkingKey,
        thinkingExpanded,
        thinkingHtml,
        hasText || hasTools || hasInvoking
      );
    }
    if (hasText) {
      var richBubble = state.flags.richText && textHtml ? ' rich' : '';
      var inner = textHtml || escapeHtml(text || '');
      html += '<div class="bubble-body' + richBubble + '">' + inner + '</div>';
    } else if (hasThinking) {
      // WHY: 仅有 thinking、正文为空时预置空 .bubble-body，供后续 text 增量挂载。
      var richShellBubble = state.flags.richText && textHtml ? ' rich' : '';
      html += '<div class="bubble-body' + richShellBubble + '" data-text-shell="1"></div>';
    }
    if (hasInvoking) {
      html += renderToolInvokingBar();
    }
    if (hasTools) {
      html += renderToolGroupSection(tools, toolGroupKey, toolGroupExpanded, false);
    }
    return html;
  }

  function renderToolOnlyBubble(tools, toolGroupKey, toolGroupExpanded, options) {
    var bubbleClass = 'bubble bubble--fill-width';
    if (options && options.bubbleExtraClass) {
      bubbleClass += ' ' + options.bubbleExtraClass;
    }
    var sectionOpts = options && options.groupTitle
      ? { groupTitle: options.groupTitle }
      : undefined;
    return '<div class="' + bubbleClass + '">' +
      renderToolGroupSection(tools, toolGroupKey, toolGroupExpanded, false, sectionOpts) +
      '</div>';
  }

  function renderUserVfsTurnRow(row) {
    if (!row.tools || row.tools.length === 0) {
      return '';
    }
    var hidden = row.hidden ? ' hidden' : '';
    var html = '<div class="row message user vfs-turn-row' + hidden + '" data-id="' + escapeHtml(row.id) + '">';
    var toolGroupKey = 'vfs-turn:' + row.id;
    var toolGroupExpanded = !!state.toolGroupExpanded[toolGroupKey];
    html += renderToolOnlyBubble(
      row.tools,
      toolGroupKey,
      toolGroupExpanded,
      {
        groupTitle: '用户操作 (' + row.tools.length + ')',
        bubbleExtraClass: 'vfs-turn-bubble',
      },
    );
    html += '</div>';
    return html;
  }

  function renderRow(row) {
    if (row.kind === 'user_vfs_turn') {
      return renderUserVfsTurnRow(row);
    }
    if (row.kind === 'message') {
      return renderMessageRow(row);
    }
    return '';
  }

  function renderUserBubbleContent(text) {
    // VFS 操作卡只走结构化 row.kind === 'user_vfs_turn'；正文不再兜底解析 <action>
    return escapeHtml(text);
  }

  function renderMessageRow(row) {
    var role = row.role === 'user' ? 'user' : 'assistant';
    var hidden = row.hidden ? ' hidden' : '';
    var thinkingKey = 'msg:' + row.id;
    var thinkingExpanded = !!state.thinkingExpanded[thinkingKey];
    var html = '<div class="row message ' + role + hidden + '" data-id="' + escapeHtml(row.id) + '">';
    if (role === 'user') {
      var attachments = row.attachments || [];
      var hasAttach = attachments.length > 0;
      var hasText = !!(row.text && String(row.text).length > 0);
      if (hasAttach || hasText) {
        if (hasAttach) {
          // 正文在上、附件组在下，合进同一条 bubble
          var attachKey = 'attach:' + row.id;
          var attachExpanded = !!state.attachGroupExpanded[attachKey];
          html +=
            '<div class="bubble bubble--fill-width bubble--user-compose">' +
            (hasText
              ? '<div class="bubble-body">' +
                renderUserBubbleContent(row.text) +
                '</div>'
              : '') +
            renderAttachGroupSection(
              attachments,
              attachKey,
              attachExpanded,
              hasText,
            ) +
            '</div>';
        } else {
          html +=
            '<div class="bubble">' +
            renderUserBubbleContent(row.text) +
            '</div>';
        }
      }
    } else if (row.thinking || row.text || (row.tools && row.tools.length > 0)) {
      var toolGroupKey = 'msg:' + row.id;
      var toolGroupExpanded = !!state.toolGroupExpanded[toolGroupKey];
      html += '<div class="bubble' + assistantBubbleExtraClasses(row.textHtml, row.tools, row.text, row.thinking) + '">' +
        renderAssistantBubbleInner(
          row.text,
          row.textHtml,
          row.thinking,
          thinkingKey,
          thinkingExpanded,
          row.thinkingHtml,
          row.tools,
          toolGroupKey,
          toolGroupExpanded,
          false
        ) +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderLoadOlder() {
    if (!state.hasMore) return '';
    return '<button type="button" class="load-older" data-action="load-older">加载更早消息</button>';
  }

  function renderEmptyState() {
    var hasStream = !!(state.stream.text || state.stream.thinking || state.stream.toolInvoking);
    if (state.rows.length > 0 || hasStream) return '';
    return '<div class="empty-state">暂无消息</div>';
  }

  function flagsEqual(a, b) {
    return (
      a.richText === b.richText &&
      a.menuDisabled === b.menuDisabled
    );
  }

  function renderRows() {
    var list = document.getElementById('rows');
    if (!list) return;
    var html = renderLoadOlder();
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      if (row.kind === 'message' || row.kind === 'user_vfs_turn') {
        html += renderRow(row);
      }
    }
    html += renderStreamTailRow();
    html += renderEmptyState();
    list.innerHTML = html;
  }

/**
 * 消息长按菜单：布局、打开/关闭与指针手势。
 */
  function computeContextMenuWidth(items) {
    var longest = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].label.length > longest) longest = items[i].label.length;
    }
    var byLabel = longest * ANCHORED_MENU_CHAR_WIDTH_EST + ANCHORED_MENU_H_PADDING;
    var cap = window.innerWidth - ANCHORED_MENU_SCREEN_MARGIN * 2;
    return Math.min(cap, ANCHORED_MENU_MAX_WIDTH, Math.max(ANCHORED_MENU_MIN_WIDTH, byLabel));
  }

  function viewportHeight() {
    // position:fixed menus share the WebView layout viewport (not #scroller scroll box).
    var doc = document.documentElement;
    return doc.clientHeight || window.innerHeight;
  }

  function layoutContextMenu(anchor, contentHeight, menuWidth) {
    var screenW = window.innerWidth;
    var screenH = viewportHeight();
    var heightCap = Math.min(ANCHORED_MENU_MAX_HEIGHT_CAP, screenH * 0.45);
    var flipEstimate = Math.min(contentHeight, heightCap);
    var anchorCenterX = anchor.x + anchor.width / 2;
    var left = anchorCenterX - menuWidth / 2;
    left = Math.max(ANCHORED_MENU_SCREEN_MARGIN, Math.min(left, screenW - menuWidth - ANCHORED_MENU_SCREEN_MARGIN));
    var spaceAbove = anchor.y;
    var spaceBelow = screenH - (anchor.y + anchor.height);
    // Prefer below; flip above when bottom space is too tight.
    var placeAbove = spaceBelow < flipEstimate + ANCHORED_MENU_GAP && spaceAbove >= spaceBelow;
    var availableSpace = (placeAbove ? spaceAbove : spaceBelow) - ANCHORED_MENU_GAP - ANCHORED_MENU_SCREEN_MARGIN;
    var availableMax = Math.max(ANCHORED_MENU_ITEM_MIN_HEIGHT, availableSpace);
    var scrollable = contentHeight > availableMax + 1;
    var menuHeight = scrollable ? Math.min(contentHeight, availableMax) : contentHeight;
    if (scrollable && menuHeight > heightCap) {
      menuHeight = heightCap;
    }
    var top = placeAbove
      ? anchor.y - menuHeight - ANCHORED_MENU_GAP
      : anchor.y + anchor.height + ANCHORED_MENU_GAP;
    top = Math.max(ANCHORED_MENU_SCREEN_MARGIN, Math.min(top, screenH - menuHeight - ANCHORED_MENU_SCREEN_MARGIN));
    return { left: left, top: top, width: menuWidth, maxHeight: menuHeight, scrollable: scrollable };
  }

  function resolveMenuAnchor(messageId, clientX, clientY) {
    // Long-press finger point (viewport coords); clamp Y inside bubble for tall messages.
    var touchH = ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT;
    var y = clientY - touchH * 0.5;
    var x = clientX;
    var rowEl = document.querySelector('.row.message[data-id="' + messageId + '"]');
    var boundsEl = rowEl ? (rowEl.querySelector('.bubble') || rowEl) : null;
    if (boundsEl) {
      var rect = boundsEl.getBoundingClientRect();
      y = Math.max(rect.top, Math.min(y, rect.bottom - touchH));
    }
    return { x: x, y: y, width: 1, height: touchH };
  }

  function findMessageRow(messageId) {
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      if ((row.kind === 'message' || row.kind === 'user_vfs_turn') && row.id === messageId) {
        return row;
      }
    }
    return null;
  }

  function buildMenuItems(row, hitEl) {
    var items = [];
    if (row.text) items.push({ label: '编辑', action: 'edit' });
    items.push({ label: '复制', action: 'copy' });
    var showSetFloor = row.kind === 'message' &&
      row.role === 'user' &&
      !(hitEl && hitEl.closest && hitEl.closest('.tool-card, .tool-group-item'));
    if (showSetFloor) items.push({ label: '置位', action: 'set-floor' });
    items.push({ label: '分叉', action: 'fork' });
    if (!row.hidden) {
      items.push({ label: '回滚', action: 'rollback', danger: true });
    }
    return items;
  }

  function suppressNativeTextMenu(event) {
    event.preventDefault();
  }

  function attachMenuNativeTextBlock() {
    if (state.menuNativeTextBlockHandler) return;
    state.menuNativeTextBlockHandler = function (event) {
      var menuEl = document.getElementById('context-menu');
      var backdrop = document.getElementById('menu-backdrop');
      var target = event.target;
      if (!menuEl || !target || !target.closest) return;
      if (menuEl.contains(target) || (backdrop && backdrop.contains(target))) {
        suppressNativeTextMenu(event);
      }
    };
    document.addEventListener('contextmenu', state.menuNativeTextBlockHandler, true);
    document.addEventListener('selectstart', state.menuNativeTextBlockHandler, true);
  }

  function detachMenuNativeTextBlock() {
    if (!state.menuNativeTextBlockHandler) return;
    document.removeEventListener('contextmenu', state.menuNativeTextBlockHandler, true);
    document.removeEventListener('selectstart', state.menuNativeTextBlockHandler, true);
    state.menuNativeTextBlockHandler = null;
    document.body.classList.remove('menu-open');
  }

  function closeContextMenu(notifyHost) {
    if (!state.menu) return;
    state.menu = null;
    state.menuOpenedAt = 0;
    detachMenuNativeTextBlock();
    if (state.menuOverlayHandler) {
      document.removeEventListener('click', state.menuOverlayHandler, true);
      document.removeEventListener('touchend', state.menuOverlayHandler, true);
      state.menuOverlayHandler = null;
    }
    var menuEl = document.getElementById('context-menu');
    if (menuEl) menuEl.remove();
    var backdrop = document.getElementById('menu-backdrop');
    if (backdrop) backdrop.remove();
    if (notifyHost !== false) post('menuClosed', {});
  }

  function handleMenuOverlayEvent(event) {
    if (!state.menu) return;
    var target = event.target;
    if (!target || !target.closest) return;
    var menuEl = document.getElementById('context-menu');
    if (menuEl && menuEl.contains(target)) {
      var actionEl = target.closest('[data-action="menu-action"]');
      if (actionEl) {
        if (event.type === 'touchend') event.preventDefault();
        var messageId = actionEl.getAttribute('data-message-id');
        var menuAction = actionEl.getAttribute('data-menu-action');
        closeContextMenu(true);
        if (messageId && menuAction) {
          post('messageMenuAction', { messageId: messageId, action: menuAction });
        }
      }
      return;
    }
    var rowEl = target.closest('.row.message');
    if (rowEl && event.type === 'touchend' && state.menuOpenedAt &&
        Date.now() - state.menuOpenedAt < MENU_OPEN_GRACE_MS) {
      return;
    }
    // Backdrop lives on document.body outside #rows — capture dismiss here.
    closeContextMenu(true);
  }

  function renderContextMenu() {
    if (!state.menu) return;
    var menu = state.menu;
    var existingMenu = document.getElementById('context-menu');
    if (existingMenu) existingMenu.remove();
    var existingBackdrop = document.getElementById('menu-backdrop');
    if (existingBackdrop) existingBackdrop.remove();
    var backdrop = document.createElement('div');
    backdrop.id = 'menu-backdrop';
    backdrop.className = 'menu-backdrop';
    backdrop.setAttribute('data-action', 'close-menu');
    var menuEl = document.createElement('div');
    menuEl.id = 'context-menu';
    menuEl.className = 'context-menu';
    var menuWidth = computeContextMenuWidth(menu.items);
    var html = '';
    for (var i = 0; i < menu.items.length; i++) {
      var item = menu.items[i];
      html +=
        '<button type="button" class="menu-item' + (item.danger ? ' danger' : '') + '" data-action="menu-action" data-message-id="' +
        escapeHtml(menu.messageId) + '" data-menu-action="' + escapeHtml(item.action) + '">' +
        escapeHtml(item.label) + '</button>';
    }
    menuEl.innerHTML = html;
    document.body.appendChild(backdrop);
    document.body.appendChild(menuEl);
    // Measure rendered rows (CSS min-height + borders); estimate 48px/row overshoots on device.
    menuEl.style.position = 'fixed';
    menuEl.style.visibility = 'hidden';
    menuEl.style.left = '0';
    menuEl.style.top = '0';
    menuEl.style.width = menuWidth + 'px';
    menuEl.style.maxHeight = 'none';
    var measuredHeight = menuEl.offsetHeight || menuEl.scrollHeight;
    var contentHeight = measuredHeight > 0
      ? measuredHeight
      : menu.items.length * ANCHORED_MENU_ITEM_LAYOUT_HEIGHT;
    var layout = layoutContextMenu(menu.anchor, contentHeight, menuWidth);
    if (menu.items.length <= MESSAGE_ACTION_MENU_ITEM_COUNT) {
      layout = {
        left: layout.left,
        top: layout.top,
        width: layout.width,
        maxHeight: contentHeight,
        scrollable: false,
      };
    }
    menuEl.style.visibility = '';
    menuEl.style.left = layout.left + 'px';
    menuEl.style.top = layout.top + 'px';
    menuEl.style.width = layout.width + 'px';
    menuEl.style.height = 'auto';
    if (layout.scrollable) {
      menuEl.className = 'context-menu scrollable';
      menuEl.style.maxHeight = layout.maxHeight + 'px';
    } else {
      menuEl.className = 'context-menu';
      menuEl.style.maxHeight = 'none';
    }
    document.body.classList.add('menu-open');
    attachMenuNativeTextBlock();
    state.menuOverlayHandler = handleMenuOverlayEvent;
    document.addEventListener('click', state.menuOverlayHandler, true);
    document.addEventListener('touchend', state.menuOverlayHandler, true);
  }

  function openContextMenu(messageId, pageX, pageY, hitEl) {
    if (state.flags.menuDisabled) return;
    var row = findMessageRow(messageId);
    if (!row) return;
    post('openMessageMenu', { messageId: messageId, pageX: pageX, pageY: pageY });
    post('menuOpened', {});
    state.menu = {
      messageId: messageId,
      pageX: pageX,
      pageY: pageY,
      anchor: resolveMenuAnchor(messageId, pageX, pageY),
      items: buildMenuItems(row, hitEl),
    };
    state.menuOpenedAt = Date.now();
    renderContextMenu();
  }

  function clearLongPress() {
    if (state.longPressTimer != null) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }
    state.longPressTarget = null;
  }

  function onMessagePointerDown(event) {
    if (state.flags.menuDisabled) return;
    var rowEl = event.target && event.target.closest ? event.target.closest('.row.message') : null;
    if (!rowEl) return;
    var messageId = rowEl.getAttribute('data-id');
    if (!messageId) return;
    var touch = event.touches && event.touches[0];
    if (!touch) return;
    clearLongPress();
    state.longPressTarget = {
      messageId: messageId,
      pageX: touch.clientX,
      pageY: touch.clientY,
      hitEl: event.target,
    };
    state.longPressTimer = setTimeout(function () {
      state.longPressTimer = null;
      var target = state.longPressTarget;
      state.longPressTarget = null;
      if (target) openContextMenu(target.messageId, target.pageX, target.pageY, target.hitEl);
    }, 450);
  }

  
  function shouldCancelLongPressForMove(deltaX, deltaY, tolerancePx) {
    if (tolerancePx == null) tolerancePx = LONG_PRESS_MOVE_TOLERANCE_PX;
    return Math.hypot(deltaX, deltaY) > tolerancePx;
  }

  function onMessagePointerMove(event) {
    if (!state.longPressTarget) return;
    var touch = event.touches && event.touches[0];
    if (!touch) return;
    var dx = touch.clientX - state.longPressTarget.pageX;
    var dy = touch.clientY - state.longPressTarget.pageY;
    if (shouldCancelLongPressForMove(dx, dy, LONG_PRESS_MOVE_TOLERANCE_PX)) {
      clearLongPress();
    }
  }

  function onMessagePointerUp() {
    clearLongPress();
  }

/**
 * 流式尾部相位、增量 DOM 与 batch/delta 提交（不含 stream-markdown）。
 */
  function streamHasContent() {
    return (
      (state.stream.text && String(state.stream.text).trim().length > 0) ||
      (state.stream.thinking && String(state.stream.thinking).trim().length > 0)
    );
  }

  /** active | waiting-first | idle-after-content */
  function getStreamTailPhase() {
    if (!state.stream.toolInvoking) {
      return 'active';
    }
    return streamHasContent() ? 'idle-after-content' : 'waiting-first';
  }

  function renderStreamWaitingFirstRow() {
    return (
      '<div class="row stream stream--waiting-first" id="stream-tail">' +
      '<div class="stream-waiting-indicator">' +
      '<span class="tool-invoking-dot" aria-hidden="true"></span>' +
      '<span class="tool-invoking-label">生成中</span></div></div>'
    );
  }

  function shouldRenderStreamTail() {
    return streamHasContent() || state.stream.toolInvoking;
  }

  function renderStreamTailRow() {
    if (!shouldRenderStreamTail()) {
      return '';
    }
    if (getStreamTailPhase() === 'waiting-first') {
      return renderStreamWaitingFirstRow();
    }
    return (
      '<div class="row stream" id="stream-tail"><div class="bubble assistant' +
      assistantBubbleExtraClasses(
        state.stream.textHtml,
        [],
        state.stream.text,
        state.stream.thinking
      ) + '">' +
      renderStreamBubbleInner() +
      '</div></div>'
    );
  }

  function streamThinkingHtml() {
    if (state.flags.richText && state.stream.thinkingHtml) {
      return state.stream.thinkingHtml;
    }
    return null;
  }

  function assistantBubbleExtraClasses(textHtml, tools, text, thinking) {
    var extra = '';
    var hasText = !!(text && String(text).trim());
    var hasThinking = !!(thinking && String(thinking).trim());
    var hasTools = !!(tools && tools.length > 0);
    if (!hasText && (hasThinking || hasTools)) {
      extra += ' bubble--fill-width';
    }
    return extra;
  }

  function renderStreamBubbleInner() {
    var showIdleBar = getStreamTailPhase() === 'idle-after-content';
    return renderAssistantBubbleInner(
      state.stream.text,
      state.stream.textHtml,
      state.stream.thinking,
      'stream:thinking',
      true,
      streamThinkingHtml(),
      [],
      'stream:tools',
      false,
      showIdleBar
    );
  }

  function updateStreamBubble(tail) {
    var bubble = tail.querySelector('.bubble');
    var bubbleClass = 'bubble assistant' + assistantBubbleExtraClasses(
      state.stream.textHtml,
      [],
      state.stream.text,
      state.stream.thinking
    );
    var inner = renderStreamBubbleInner();
    if (!inner) return;
    if (bubble) {
      bubble.className = bubbleClass;
      bubble.innerHTML = inner;
      return;
    }
    var el = document.createElement('div');
    el.className = bubbleClass;
    el.innerHTML = inner;
    tail.appendChild(el);
  }

  function ensureStreamTextBody(bubble) {
    var textBody = bubble.querySelector('.bubble-body');
    if (textBody) {
      return textBody;
    }
    textBody = document.createElement('div');
    textBody.className = 'bubble-body';
    textBody.setAttribute('data-text-shell', '1');
    bubble.appendChild(textBody);
    var thinkingBody = bubble.querySelector('[data-thinking-key="stream:thinking"] .thinking-body');
    if (thinkingBody) {
      thinkingBody.classList.add('thinking-body-divided');
    }
    return textBody;
  }

  function setStreamBodyRichClass(el, rich) {
    if (!el) return;
    if (rich) {
      el.classList.add('rich');
    } else {
      el.classList.remove('rich');
    }
  }

  function streamRichDomReady(bubble, kind) {
    if (kind === 'thinking') {
      var section = bubble.querySelector('[data-thinking-key="stream:thinking"]');
      var body = section ? section.querySelector('.thinking-body') : null;
      return !!(body && (body.innerHTML.length > 0 || (body.textContent && body.textContent.length > 0)));
    }
    var textBody = bubble.querySelector('.bubble-body');
    return !!(textBody && (textBody.innerHTML.length > 0 || (textBody.textContent && textBody.textContent.length > 0)));
  }

  function appendStreamDeltaIncremental(tail, kind, delta, html) {
    // 主线程卡顿验证：增量 DOM 更新路径；耗时由 appendStreamDelta 外层 delta_trace 汇总
    if (!delta && !html) {
      return false;
    }
    var bubble = tail.querySelector('.bubble');
    if (!bubble) {
      return false;
    }
    // richText + 无 html：走 UAUA plain-mode 增量路径；有 html 时交由后续分支做 DOM 替换。
    if (state.flags.richText && !html) {
      if (!delta) {
        return false;
      }
      if (kind === 'thinking') {
        if (!streamRichDomReady(bubble, kind)) {
          return false;
        }
        if (!streamRichUpgrade.plainMode.thinking) {
          scheduleStreamRichUpgrade(kind);
          return true;
        }
        var thinkSection = bubble.querySelector('[data-thinking-key="stream:thinking"]');
        var thinkBody = thinkSection ? thinkSection.querySelector('.thinking-body') : null;
        if (!thinkBody) {
          return false;
        }
        thinkBody.insertAdjacentHTML('beforeend', escapeHtml(delta));
        setStreamBodyRichClass(thinkBody, false);
      } else if (kind === 'text') {
        // WHY: richText=true 且 html 缺失时，text 首包必须稳定走 delta append，
        // 不能被 DOM-ready 门槛拦截，否则 appendStreamDeltaIncremental 会返回 false 且 text 分支禁止整泡重建。
        var streamTextBody = ensureStreamTextBody(bubble);
        streamTextBody.insertAdjacentHTML('beforeend', escapeHtml(delta));
        setStreamBodyRichClass(streamTextBody, false);
      } else {
        return false;
      }
      scheduleStreamRichUpgrade(kind);
      return true;
    }
    if (kind === 'thinking') {
      var section = bubble.querySelector('[data-thinking-key="stream:thinking"]');
      var body = section ? section.querySelector('.thinking-body') : null;
      if (!body) {
        return false;
      }
      if (html && state.flags.richText) {
        body.innerHTML = html;
        setStreamBodyRichClass(body, true);
        bubble.className = 'bubble assistant' + assistantBubbleExtraClasses(
          state.stream.textHtml,
          [],
          state.stream.text,
          state.stream.thinking,
          undefined
        );
        return true;
      }
      if (!delta) {
        return false;
      }
      body.insertAdjacentHTML('beforeend', escapeHtml(delta));
      setStreamBodyRichClass(body, false);
      return true;
    }
    if (kind === 'text') {
      var textBody = ensureStreamTextBody(bubble);
      if (html && state.flags.richText) {
        // WHY: 保持与 RN prepareStreamTailHtml 的 rich 复用语义一致：
        // 有 html 且 rich 打开时直接 innerHTML 替换；否则走 delta 增量追加，避免整泡 updateStreamBubble 重建。
        textBody.innerHTML = html;
        setStreamBodyRichClass(textBody, true);
        bubble.className = 'bubble assistant' + assistantBubbleExtraClasses(
          state.stream.textHtml,
          [],
          state.stream.text,
          state.stream.thinking,
          undefined
        );
        return true;
      }
      if (!delta) {
        return false;
      }
      // WHY: text 从 0->1 仅更新 class/展示，不触发 thinking 重建。
      textBody.insertAdjacentHTML('beforeend', escapeHtml(delta));
      setStreamBodyRichClass(textBody, false);
      bubble.className = 'bubble assistant' + assistantBubbleExtraClasses(
        state.stream.textHtml,
        [],
        state.stream.text,
        state.stream.thinking
      );
      return true;
    }
    return false;
  }

  function setStreamToolInvokingDom(active) {
    state.stream.toolInvoking = !!active;
    var tail = document.getElementById('stream-tail');
    if (!tail) {
      if (shouldRenderStreamTail()) {
        renderRows();
        scheduleStickIfNearBottom();
      }
      return;
    }
    var isWaitingShell = tail.classList.contains('stream--waiting-first');
    var phase = getStreamTailPhase();
    if (isWaitingShell && phase !== 'waiting-first') {
      renderRows();
      scheduleStickIfNearBottom();
      return;
    }
    if (!isWaitingShell && phase === 'waiting-first') {
      renderRows();
      scheduleStickIfNearBottom();
      return;
    }
    if (phase === 'waiting-first') {
      if (!active && !streamHasContent()) {
        renderRows();
        scheduleStickIfNearBottom();
      }
      return;
    }
    var bubble = tail.querySelector('.bubble');
    if (!bubble) {
      renderRows();
      scheduleStickIfNearBottom();
      return;
    }
    var existing = bubble.querySelector('.tool-invoking-bar');
    if (active) {
      if (!existing) {
        var holder = document.createElement('div');
        holder.innerHTML = renderToolInvokingBar();
        var bar = holder.firstElementChild;
        if (bar) {
          var textBody = bubble.querySelector('.bubble-body');
          if (textBody) {
            textBody.insertAdjacentElement('afterend', bar);
          } else {
            bubble.appendChild(bar);
          }
        }
      }
    } else if (existing) {
      existing.remove();
    }
    if (!shouldRenderStreamTail()) {
      renderRows();
      scheduleStickIfNearBottom();
    }
  }

  function appendStreamDelta(kind, delta, html) {
    if (kind === 'text') {
      state.stream.text += delta;
      if (html) {
        state.stream.textHtml = html;
      } else if (state.flags.richText) {
        state.stream.textHtml = '';
      }
    } else {
      state.stream.thinking += delta;
      if (html) {
        state.stream.thinkingHtml = html;
      } else if (state.flags.richText) {
        state.stream.thinkingHtml = '';
      }
    }
    var tail = document.getElementById('stream-tail');
    if (!tail) {
      renderRows();
      scheduleStickIfNearBottom();
      return;
    }
    if (tail.classList.contains('stream--waiting-first') || !tail.querySelector('.bubble')) {
      renderRows();
      scheduleStickIfNearBottom();
      return;
    }
    var incremental = appendStreamDeltaIncremental(tail, kind, delta, html);
    if (!incremental && kind !== 'text') {
      // WHY: 正文 text 不能在增量失败时整泡重建（会触发 thinking DOM 相关副作用）。
      // 只有在不存在 #stream-tail 时，我们才允许一次性 fallback 到 renderRows()。
      updateStreamBubble(tail);
      if (state.flags.richText) {
        scheduleStreamRichUpgrade(kind);
      }
    }
    scheduleStickIfNearBottom();
  }

  function applyStreamBatch(payload) {
    var segments = payload.segments || [];
    var lastTextIdx = -1;
    var lastThinkIdx = -1;
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].kind === 'text') {
        lastTextIdx = i;
      } else {
        lastThinkIdx = i;
      }
    }
    for (var j = 0; j < segments.length; j++) {
      var seg = segments[j];
      var html;
      if (seg.kind === 'text' && j === lastTextIdx) {
        html = state.flags.richText ? (payload.textHtml || '') : undefined;
      } else if (seg.kind === 'thinking' && j === lastThinkIdx) {
        html = state.flags.richText ? (payload.thinkingHtml || '') : undefined;
      }
      appendStreamDelta(seg.kind, seg.delta, html);
    }
    scheduleStickIfNearBottom();
  }

/**
 * 会话快照、prepend/append 与 streamCommit 编排。
 */
  function applySnapshot(payload) {
    var intent = payload.scrollIntent || 'stick';
    var scroller = document.getElementById('scroller');
    var wasNearBottom = state.nearBottom;
    var prevOffsetFromBottom = scroller ? offsetFromBottom(scroller) : 0;
    var sessionChanged = payload.sessionKey && payload.sessionKey !== state.sessionKey;

    state.sessionKey = payload.sessionKey || state.sessionKey;
    state.rows = (payload.rows || []).slice();
    state.hasMore = !!payload.hasMore;
    state.loadOlderArmed = true;
    if (intent !== 'preserve' || sessionChanged) {
      state.stream = { text: '', thinking: '', textHtml: '', thinkingHtml: '', toolInvoking: false };
    }
    if (sessionChanged) {
      closeContextMenu(false);
    }
    var scrollAfterRender = function () {
      if (!scroller) return;
      if (intent === 'stick') {
        stickToBottom(scroller);
      } else if (intent === 'restore' && payload.restoreScroll) {
      var rs = payload.restoreScroll;
      if (rs.nearBottom) {
        stickToBottom(scroller);
      } else {
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight - rs.offsetY
        );
      }
      } else if (intent === 'preserve') {
        if (wasNearBottom) {
          stickToBottom(scroller);
        } else {
          // WHY: flex-end layout shrinks tail — restore distance-from-bottom, not raw scrollTop.
          scroller.scrollTop = Math.max(
            0,
            scroller.scrollHeight - scroller.clientHeight - prevOffsetFromBottom
          );
        }
      }
      state.nearBottom = isNearBottom(scroller);
      emitScrollSnapshot();
    };
    requestAnimationFrame(function () {
      if (intent === 'stick' && scroller) {
        scroller.scrollTop = 0;
      }
      renderRows();
      if (payload.generating) {
        setStreamToolInvokingDom(true);
      }
      if (intent === 'stick') {
        requestAnimationFrame(function () {
          scrollAfterRender();
        });
      } else {
        scrollAfterRender();
      }
    });
  }

  /**
   * appendTailRows: append persisted rows at end without full renderRows.
   * Preserves stream tail and scroll anchor when not near bottom.
   */
  function applyAppendTailRows(payload) {
    var newRows = (payload.rows || []).slice();
    if (newRows.length === 0) {
      return;
    }
    var scroller = document.getElementById('scroller');
    var wasNearBottom = state.nearBottom;
    var prevOffsetFromBottom = scroller ? offsetFromBottom(scroller) : 0;
    state.rows = state.rows.concat(newRows);
    var html = '';
    for (var i = 0; i < newRows.length; i++) {
      var row = newRows[i];
      if (row.kind === 'message' || row.kind === 'user_vfs_turn') {
        html += renderRow(row);
      }
    }
    var list = document.getElementById('rows');
    if (!list) {
      return;
    }
    var streamTail = document.getElementById('stream-tail');
    if (streamTail) {
      streamTail.insertAdjacentHTML('beforebegin', html);
    } else {
      var empty = list.querySelector('.empty-state');
      if (empty) {
        empty.insertAdjacentHTML('beforebegin', html);
        empty.remove();
      } else {
        list.insertAdjacentHTML('beforeend', html);
      }
    }
    if (scroller) {
      if (wasNearBottom) {
        stickToBottom(scroller);
      } else {
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight - prevOffsetFromBottom
        );
      }
      state.nearBottom = isNearBottom(scroller);
      emitScrollSnapshot();
    }
  }

  /**
   * streamCommit: 流式结束单次提交 — 清 stream 状态、追加落库行；优先 promote #stream-tail。
   */
  function promoteStreamTailToRow(row) {
    if (!row || row.kind !== 'message') {
      return false;
    }
    var streamTail = document.getElementById('stream-tail');
    if (!streamTail) {
      return false;
    }
    var rowHtml = renderRow(row);
    if (!rowHtml) {
      return false;
    }
    streamTail.outerHTML = rowHtml;
    return true;
  }

  function applyStreamCommit(payload) {
    var newRows = (payload.rows || []).slice();
    var toAppend = [];
    for (var i = 0; i < newRows.length; i++) {
      var row = newRows[i];
      if (row.kind !== 'message' && row.kind !== 'user_vfs_turn') {
        continue;
      }
      var dup = false;
      for (var j = 0; j < state.rows.length; j++) {
        var existing = state.rows[j];
        if (
          (existing.kind === 'message' || existing.kind === 'user_vfs_turn') &&
          existing.id === row.id
        ) {
          dup = true;
          break;
        }
      }
      if (!dup) {
        toAppend.push(row);
      }
    }
    if (toAppend.length === 0) {
      renderRows();
      return;
    }
    var scroller = document.getElementById('scroller');
    var wasNearBottom = state.nearBottom;
    var prevOffsetFromBottom = scroller ? offsetFromBottom(scroller) : 0;
    state.rows = state.rows.concat(toAppend);
    var promoted =
      toAppend.length === 1 &&
      toAppend[0].kind === 'message' &&
      promoteStreamTailToRow(toAppend[0]);
    if (!promoted) {
      renderRows();
    }
    var scrollIntent = payload.scrollIntent || 'preserve';
    if (scroller) {
      if (scrollIntent === 'preserve' && wasNearBottom) {
        stickToBottom(scroller);
      } else if (scrollIntent === 'preserve') {
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight - prevOffsetFromBottom
        );
      }
      state.nearBottom = isNearBottom(scroller);
      emitScrollSnapshot();
    }
  }

  /**
   * prependPage: only new older rows — NOT a full sessionSnapshot reload.
   * Anchor reading position: scrollTop += scrollHeight - prependedScrollHeight.
   */
  function applyPrependPage(payload) {
    var newRows = (payload.rows || []).slice();
    var scroller = document.getElementById('scroller');
    var prependedScrollHeight = scroller ? scroller.scrollHeight : 0;
    var prependedScrollTop = scroller ? scroller.scrollTop : 0;
    state.rows = newRows.concat(state.rows);
    state.loadOlderArmed = true;
    renderRows();
    if (scroller) {
      var nextScrollHeight = scroller.scrollHeight;
      scroller.scrollTop = prependedScrollTop + (nextScrollHeight - prependedScrollHeight);
      state.nearBottom = isNearBottom(scroller);
    }
    emitScrollSnapshot();
  }

/**
 * #rows 点击：折叠开关、打开工具文件、加载更早等。
 */
  function onRowsClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var actionEl = target.closest('[data-action]');
    if (!actionEl) return;
    var action = actionEl.getAttribute('data-action');
    if (action === 'close-menu') {
      closeContextMenu(true);
      return;
    }
    if (action === 'menu-action') {
      var messageId = actionEl.getAttribute('data-message-id');
      var menuAction = actionEl.getAttribute('data-menu-action');
      closeContextMenu(true);
      if (messageId && menuAction) {
        post('messageMenuAction', { messageId: messageId, action: menuAction });
      }
      return;
    }
    if (action === 'toggle-thinking') {
      var key = actionEl.getAttribute('data-thinking-key');
      if (key) {
        state.thinkingExpanded[key] = !state.thinkingExpanded[key];
        renderRows();
      }
      return;
    }
    if (action === 'toggle-tool-group') {
      var tgKey = actionEl.getAttribute('data-tool-group-key');
      if (tgKey) {
        state.toolGroupExpanded[tgKey] = !state.toolGroupExpanded[tgKey];
        renderRows();
      }
      return;
    }
    if (action === 'toggle-attach-group') {
      var agKey = actionEl.getAttribute('data-attach-group-key');
      if (agKey) {
        state.attachGroupExpanded[agKey] = !state.attachGroupExpanded[agKey];
        renderRows();
      }
      return;
    }
    if (action === 'open-tool-file') {
      var path = actionEl.getAttribute('data-path');
      if (path) post('openToolFile', { path: path });
      return;
    }
    if (action === 'load-older') {
      requestLoadOlder();
    }
  }

/**
 * RN 桥：postMessage、主题应用与宿主消息分发。
 */
  function post(type, payload) {
    var msg = JSON.stringify({ v: BRIDGE_V, type: type, payload: payload || {} });
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(msg);
    }
  }

  function applyTheme(theme) {
    if (!theme) return;
    var root = document.documentElement;
    root.style.setProperty('--bg', theme.background || '#fff');
    root.style.setProperty('--text', theme.text || '#111');
    root.style.setProperty('--text-secondary', theme.textSecondary || '#666');
    root.style.setProperty('--primary', theme.primary || '#007aff');
    root.style.setProperty('--danger', theme.danger || '#d92d20');
    root.style.setProperty('--surface', theme.surface || '#f2f2f7');
    root.style.setProperty('--border', theme.borderLight || '#e5e5ea');
  }

  function handleHostMessage(raw) {
    var msg;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return;
    }
    if (!msg || msg.v !== BRIDGE_V || !msg.type) return;
    var p = msg.payload || {};
    switch (msg.type) {
      case 'init':
        applyTheme(p.theme);
        if (p.flags) {
          state.flags = {
            richText: !!p.flags.richText,
            menuDisabled: !!p.flags.menuDisabled,
          };
        }
        break;
      case 'sessionSnapshot':
        applySnapshot(p);
        break;
      case 'prependPage':
        applyPrependPage(p);
        break;
      case 'appendTailRows':
        applyAppendTailRows(p);
        break;
      case 'streamDelta': {
        appendStreamDelta(p.kind, p.delta || '', p.html || '');
        break;
      }
      case 'streamBatch': {
        applyStreamBatch(p);
        break;
      }
      case 'streamReset':
        clearStreamRichUpgrade();
        state.stream = { text: '', thinking: '', textHtml: '', thinkingHtml: '', toolInvoking: false };
        renderRows();
        break;
      case 'streamCommit':
        clearStreamRichUpgrade();
        state.stream = { text: '', thinking: '', textHtml: '', thinkingHtml: '', toolInvoking: false };
        applyStreamCommit(p);
        break;
      case 'streamToolInvoking':
        setStreamToolInvokingDom(!!p.active);
        break;
      case 'flagsUpdate':
        if (p.flags) {
          var nextFlags = {
            richText: !!p.flags.richText,
            menuDisabled: !!p.flags.menuDisabled,
          };
          if (flagsEqual(state.flags, nextFlags)) {
            break;
          }
          var richToggledOn = !state.flags.richText && nextFlags.richText;
          state.flags = nextFlags;
          if (state.flags.menuDisabled) {
            closeContextMenu(true);
          }
          // Rich on: wait for sessionSnapshot rows with textHtml (avoid escapeHtml fallback).
          if (!richToggledOn) {
            renderRows();
          }
        }
        break;
      case 'themeUpdate':
        applyTheme(p.theme);
        break;
      case 'closeMenu':
        closeContextMenu(true);
        break;
      default:
        break;
    }
  }

  function onHostMessage(event) {
    var data = event && event.data;
    if (data == null) return;
    handleHostMessage(data);
  }

/**
 * chat-transcript boot 入口收尾：宿主 message 监听 + bootTranscript + readyState 兜底。
 */
document.addEventListener('message', onHostMessage);
  window.addEventListener('message', onHostMessage);

  function bootTranscript() {
    var scroller = document.getElementById('scroller');
    var rows = document.getElementById('rows');
    if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
    if (rows) {
      rows.addEventListener('click', onRowsClick);
      rows.addEventListener('touchstart', onMessagePointerDown, { passive: true });
      rows.addEventListener('touchmove', onMessagePointerMove, { passive: true });
      rows.addEventListener('touchend', onMessagePointerUp, { passive: true });
      rows.addEventListener('touchcancel', onMessagePointerUp, { passive: true });
    }
    // RN WebView html source 上 DOMContentLoaded 可能已错过；readyState 兜底
    post('ready', { version: 'm3', readyState: document.readyState });
    state.ready = true;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootTranscript);
  } else {
    bootTranscript();
  }

})();</script>
</body>
</html>
`;
