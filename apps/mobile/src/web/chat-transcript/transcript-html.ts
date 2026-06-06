/**
 * Inline HTML bundle for ChatTranscriptWebView (M0: template + boot IIFE).
 */
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
    .row { display: flex; width: 100%; }
    .row.user { justify-content: flex-end; }
    .row.assistant, .row.stream { justify-content: flex-start; }
    .bubble { max-width: 85%; padding: 10px 14px; border-radius: 16px; white-space: pre-wrap; word-break: break-word; font-size: 15px; line-height: 1.4; }
    .row.user .bubble { background: var(--primary, #007aff); color: #fff; }
    .row.assistant .bubble, .row.stream .bubble { background: var(--surface, #f2f2f7); color: var(--text, #111); }
    .row.hidden .bubble { opacity: 0.45; }
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
