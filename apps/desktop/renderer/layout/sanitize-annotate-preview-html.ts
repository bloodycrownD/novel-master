/**
 * Desktop 预览认锚 HTML 消毒：与 Mobile sanitizeRichHtml 同源白名单思路，
 * 并显式放行 `data-annotate-id`（XSS / Step 4 合同）。
 */

import sanitizeHtml from "sanitize-html";

const DISALLOWED_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "textarea",
  "select",
  "button",
] as const;

/**
 * 消毒批注派生串：保留约定锚 `span.nm-annotate-anchor` + `data-annotate-id`，
 * 剥掉 script / 事件属性 / 非约定危险标签。
 */
export function sanitizeAnnotatePreviewHtml(html: string): string {
  return sanitizeHtml(html, {
    disallowedTagsMode: "escape",
    parseStyleAttributes: false,
    nonTextTags: ["script", "textarea", "option"],
    allowedTags: sanitizeHtml.defaults.allowedTags
      .concat(["img", "div", "span", "table", "thead", "tbody", "tr", "th", "td"])
      .filter(
        (tag: string) =>
          !DISALLOWED_TAGS.includes(tag as (typeof DISALLOWED_TAGS)[number]),
      ),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": ["style", "class", "id"],
      // 锚点合同：须显式放行，仅靠 class 不够
      span: ["style", "class", "id", "data-annotate-id"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      td: ["colspan", "rowspan", "style", "class"],
      th: ["colspan", "rowspan", "style", "class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowVulnerableTags: true,
  });
}
