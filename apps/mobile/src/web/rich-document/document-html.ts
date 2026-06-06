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
    #doc-wrap { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
    #doc { flex: 1; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; padding: 0; font-size: 15px; line-height: 1.45; }
    #over-limit-hint { display: none; flex-shrink: 0; padding: 6px 0 0; font-size: 12px; color: var(--text-secondary, #666); }
    ${RICH_DOCUMENT_RICH_CSS}
  </style>
</head>
<body>
  <div id="doc-wrap">
    <div id="doc"></div>
    <div id="over-limit-hint"></div>
  </div>
  <script>__BOOT__</script>
</body>
</html>`;

export const RICH_DOCUMENT_BASE_URL = 'https://novel-master.local/';

export const RICH_DOCUMENT_HTML = HTML_TEMPLATE.replace(
  '__BOOT__',
  buildRichDocumentBootScript(),
);
