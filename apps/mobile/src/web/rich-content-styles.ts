/**
 * Shared rich-text CSS for WebView surfaces (chat bubbles + document preview).
 * Single source of truth — chat transcript wraps selectors; document uses #doc .doc-body.rich.
 */

/** Builds compound-selector rules (e.g. `.bubble.rich p, .thinking-body.rich p`). */
export function buildRichContentCssRules(selectors: readonly string[]): string {
  const group = selectors.join(', ');
  const child = (tag: string) => selectors.map(s => `${s} ${tag}`).join(', ');
  const nestedList = selectors
    .map(s => `${s} ul ul, ${s} ol ol, ${s} ul ol, ${s} ol ul`)
    .join(', ');
  const liAdjacent = selectors.map(s => `${s} li + li`).join(', ');
  const liParagraph = selectors.map(s => `${s} li > p`).join(', ');
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

/** Chat transcript bubble + thinking body rich rules. */
export const CHAT_TRANSCRIPT_RICH_CSS = buildRichContentCssRules([
  '.bubble.rich',
  '.bubble-body.rich',
  '.thinking-body.rich',
]);

/** Document preview body (.doc-body.rich inside #doc) — same typography as chat bubbles. */
export const RICH_DOCUMENT_RICH_CSS = buildRichContentCssRules([
  '#doc .doc-body.rich',
]);
