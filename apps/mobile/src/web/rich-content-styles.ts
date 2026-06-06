/**
 * Shared rich-text CSS for WebView surfaces (chat bubbles + document preview).
 * Single source of truth — chat transcript wraps selectors; document uses #doc.rich.
 */

/** Builds compound-selector rules (e.g. `.bubble.rich p, .thinking-body.rich p`). */
export function buildRichContentCssRules(selectors: readonly string[]): string {
  const group = selectors.join(', ');
  const child = (tag: string) => selectors.map(s => `${s} ${tag}`).join(', ');
  return `
    ${group} { white-space: normal; overflow-wrap: anywhere; }
    ${child('p')} { margin: 0.35em 0; }
    /* Global reset strips list padding; indent so outside markers stay inside the content area. */
    ${child('ol')}, ${child('ul')} { margin: 0.35em 0; padding-left: 1.35em; }
    ${child('li')} { margin: 0.15em 0; }
    ${child('blockquote')} {
      margin: 0.35em 0; padding-left: 0.75em;
      border-left: 3px solid var(--border, #e5e5ea);
    }
    ${child('h1')}, ${child('h2')}, ${child('h3')} { font-size: 1em; font-weight: 700; margin: 0.35em 0; }
    ${child('code')} { font-family: ui-monospace, monospace; font-size: 0.9em; background: rgba(0,0,0,0.06); padding: 0.1em 0.25em; border-radius: 4px; }
    ${child('pre')} { overflow-x: auto; margin: 0.35em 0; }
    ${child('a')} { color: var(--primary, #007aff); }
  `.trim();
}

/** Chat transcript bubble + thinking body rich rules. */
export const CHAT_TRANSCRIPT_RICH_CSS = buildRichContentCssRules([
  '.bubble.rich',
  '.thinking-body.rich',
]);

/** Document preview body (#doc.rich) — same typography as chat bubbles. */
export const RICH_DOCUMENT_RICH_CSS = buildRichContentCssRules(['#doc.rich']);
