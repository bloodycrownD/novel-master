/**
 * Inline HTML bundle for RichDocumentWebView (template + boot IIFE).
 */
import {RICH_DOCUMENT_RICH_CSS} from '../rich-content-styles';
import {buildRichDocumentBootScript} from './main';

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; background: var(--bg, #fff); color: var(--text, #111); font-family: system-ui, -apple-system, sans-serif; }
    #doc-wrap { height: 100%; overflow: hidden; }
    /* FM + body + hint scroll together inside #doc (no separate RN FM card). */
    #doc { height: 100%; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; padding: 12px; font-size: 15px; line-height: 1.45; }
    .doc-body { margin-top: 0; white-space: pre-wrap; word-break: break-word; }
    .doc-body.rich { white-space: normal; }
    .fm-card { margin-bottom: 16px; padding: 12px; border-radius: 10px; border: 1px solid var(--border, #e5e5ea); background: var(--surface, #f2f2f7); }
    .fm-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary, #666); margin-bottom: 8px; }
    .fm-error { font-size: 13px; color: #ff3b30; margin-bottom: 6px; }
    .fm-empty { font-size: 13px; color: var(--text-secondary, #666); }
    .fm-row { margin-bottom: 6px; }
    .fm-key { font-size: 12px; font-weight: 500; color: var(--text-secondary, #666); }
    .fm-value { font-size: 15px; line-height: 21px; color: var(--text, #111); }
    .fm-mono { font-family: ui-monospace, monospace; }
    .over-limit-hint { margin-top: 6px; font-size: 12px; color: var(--text-secondary, #666); }
    ${RICH_DOCUMENT_RICH_CSS}
  </style>
</head>
<body>
  <div id="doc-wrap"><div id="doc"></div></div>
  <script>__BOOT__</script>
</body>
</html>`;

export const RICH_DOCUMENT_BASE_URL = 'https://novel-master.local/';

export const RICH_DOCUMENT_HTML = HTML_TEMPLATE.replace(
  '__BOOT__',
  buildRichDocumentBootScript(),
);
