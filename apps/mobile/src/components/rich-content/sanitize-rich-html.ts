import sanitizeHtml from 'sanitize-html';

const DISALLOWED_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'select',
  'button',
] as const;

/**
 * Strips dangerous tags and event-handler attributes from HTML before RenderHTML.
 */
export function sanitizeRichHtml(html: string): string {
  return sanitizeHtml(html, {
    disallowedTagsMode: 'discard',
    nonTextTags: ['style', 'script', 'textarea', 'option'],
    allowedTags: sanitizeHtml.defaults.allowedTags
      .concat(['img', 'style', 'div', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td'])
      .filter(tag => !DISALLOWED_TAGS.includes(tag as (typeof DISALLOWED_TAGS)[number])),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['style', 'class', 'id'],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      td: ['colspan', 'rowspan', 'style', 'class'],
      th: ['colspan', 'rowspan', 'style', 'class'],
    },
    // sanitize-html: strip on* and other unsafe attrs not in allowedAttributes
    allowedSchemes: ['http', 'https', 'mailto'],
    // style tag allowed for .md <style> blocks; scripts/iframes still blocked
    allowVulnerableTags: true,
  });
}
