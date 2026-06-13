/**
 * Inline HTML bundle for ChatTranscriptWebView (template + boot IIFE).
 */
import {CHAT_TRANSCRIPT_RICH_CSS} from '../rich-content-styles';
import {buildTranscriptBootScript} from './main';

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; background: var(--bg, #fff); color: var(--text, #111); font-family: system-ui, -apple-system, sans-serif; }
    #scroller { height: 100%; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; }
    #rows { display: flex; flex-direction: column; min-height: 100%; justify-content: flex-end; padding: 8px 12px 12px; gap: 8px; }
    .row { display: flex; width: 100%; flex-direction: column; }
    .row.user { align-items: flex-end; }
    .row.assistant, .row.stream, .row.tool { align-items: flex-start; }
    .bubble { max-width: 85%; padding: 10px 14px; border-radius: 16px; white-space: pre-wrap; word-break: break-word; font-size: 15px; line-height: 1.4; }
    .row.user .bubble { background: var(--primary, #007aff); color: #fff; }
    .row.assistant .bubble, .row.stream .bubble { background: var(--surface, #f2f2f7); color: var(--text, #111); }
    .row.hidden .bubble { opacity: 0.45; }
    .bubble .thinking-section { margin: 0; padding: 0; border: none; background: transparent; max-width: none; }
    .thinking-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent; }
    .thinking-title { font-size: 12px; font-weight: 600; color: var(--text-secondary, #666); }
    .thinking-chevron { font-size: 10px; color: var(--text-secondary, #888); }
    .thinking-body { margin-top: 6px; font-size: 13px; line-height: 1.45; color: var(--text-secondary, #666); white-space: pre-wrap; word-break: break-word; }
    .thinking-body-divided { padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid var(--border, #e5e5ea); }
    .bubble-body { font-size: 15px; line-height: 1.4; color: inherit; white-space: pre-wrap; word-break: break-word; }
    .bubble .tool-group-section { margin: 0; padding: 0; border: none; background: transparent; max-width: none; }
    .tool-group-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent; }
    .tool-group-title { font-size: 12px; font-weight: 600; color: var(--text-secondary, #666); }
    .tool-group-chevron { font-size: 10px; color: var(--text-secondary, #888); }
    .tool-group-items { margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
    .tool-group-divided { padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid var(--border, #e5e5ea); }
    .tool-card { max-width: 92%; width: 100%; margin: 2px 0; padding: 12px; border-radius: 8px; border: 1px solid var(--border, #e5e5ea); background: var(--surface, #f2f2f7); }
    .tool-group-item.tool-card { max-width: none; width: 100%; margin: 0; }
    .tool-card.tappable { border-color: var(--primary, #007aff); cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .tool-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .tool-name { flex: 1; font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tool-status { font-size: 12px; font-weight: 500; }
    .tool-status.success { color: var(--primary, #007aff); }
    .tool-status.error { color: #ff3b30; }
    .tool-phase-bar { margin-top: 6px; font-size: 13px; font-weight: 500; color: var(--text-secondary, #888); }
    .tool-invoking-bar { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border, #e5e5ea); font-size: 12px; font-weight: 600; color: var(--primary, #007aff); }
    .tool-invoking-dot { flex-shrink: 0; width: 8px; height: 8px; border-radius: 4px; background: var(--primary, #007aff); animation: tool-invoking-pulse 1.2s ease-in-out infinite; }
    @keyframes tool-invoking-pulse { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1); } }
    .tool-summary { margin-top: 6px; font-size: 13px; color: var(--text-secondary, #666); white-space: pre-wrap; word-break: break-word; }
    .tool-open-hint { margin-top: 8px; font-size: 12px; font-weight: 500; color: var(--primary, #007aff); }
    .load-older { align-self: center; padding: 10px 16px; font-size: 14px; color: var(--primary, #007aff); background: transparent; border: none; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    ${CHAT_TRANSCRIPT_RICH_CSS}
    .bubble-body.rich { white-space: normal; }
    .row.assistant .bubble.bubble--fill-width { width: 85%; max-width: 85%; box-sizing: border-box; }
    .row.assistant .bubble.rich,
    .row.assistant .bubble.bubble--wide { width: 92%; max-width: 92%; box-sizing: border-box; }
    .row.user .bubble.rich,
    .row.user .bubble.bubble--wide { width: 92%; max-width: 92%; box-sizing: border-box; }
    .empty-state { align-self: center; margin-top: 32px; padding: 0 24px; text-align: center; color: var(--text-secondary, #666); font-size: 14px; }
    /* Visual size reduced; row tap target via .batch-row toggle-select */
    .batch-row { display: flex; flex-direction: row; align-items: flex-start; width: 100%; gap: 6px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .batch-check { flex-shrink: 0; width: 20px; height: 20px; margin-top: 6px; border-radius: 10px; border: 1.5px solid var(--border, #c7c7cc); background: var(--bg, #fff); color: var(--primary, #007aff); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .batch-check.checked { border-color: var(--primary, #007aff); background: var(--primary, #007aff); color: #fff; }
    .batch-content { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .row.message.selected .bubble { box-shadow: 0 0 0 2px var(--primary, #007aff); }
    .menu-backdrop { position: fixed; inset: 0; z-index: 9998; background: rgba(0,0,0,0.35); -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    .context-menu { position: fixed; z-index: 9999; display: flex; flex-direction: column; flex-shrink: 0; height: fit-content; min-width: 132px; max-width: 200px; border-radius: 10px; border: 1px solid var(--border, #e5e5ea); background: var(--surface, #f2f2f7); overflow-x: hidden; overflow-y: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.15); -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: manipulation; }
    .context-menu.scrollable { overflow-y: auto; -webkit-overflow-scrolling: touch; }
    .menu-item { flex: 0 0 auto; display: block; width: 100%; min-height: 44px; padding: 0 12px; border: none; border-bottom: 1px solid var(--border, #e5e5ea); background: transparent; color: var(--text, #111); font-size: 15px; text-align: center; cursor: pointer; -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: manipulation; }
    body.menu-open { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    .menu-item:last-child { border-bottom: none; }
    .menu-item.danger { color: #ff3b30; }
  </style>
</head>
<body>
  <div id="scroller"><div id="rows"></div></div>
  <script>__BOOT__</script>
</body>
</html>`;

export const CHAT_TRANSCRIPT_BASE_URL = 'https://novel-master.local/';

export const CHAT_TRANSCRIPT_HTML = HTML_TEMPLATE.replace(
  '__BOOT__',
  buildTranscriptBootScript(),
);
