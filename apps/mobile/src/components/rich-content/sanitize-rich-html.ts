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
 * 消毒富文本 HTML：未知/禁止标签以 escape 转为实体字面量（不 discard 挖空），
 * 并剥离事件属性与危险 scheme，供 TrustedHtml / RenderHTML 使用。
 */
export function sanitizeRichHtml(html: string): string {
  return sanitizeHtml(html, {
    // 伪标签须可见：escape 为 &lt;tag&gt;；危险标签同样不可执行
    disallowedTagsMode: 'escape',
    // PostCSS 依赖 Node；Hermes 无法解析内联 style — 保留 style 属性原样
    parseStyleAttributes: false,
    nonTextTags: ['script', 'textarea', 'option'],
    allowedTags: sanitizeHtml.defaults.allowedTags
      .concat(['img', 'div', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td'])
      .filter((tag: string) =>
        !DISALLOWED_TAGS.includes(tag as (typeof DISALLOWED_TAGS)[number]),
      ),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['style', 'class', 'id'],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      td: ['colspan', 'rowspan', 'style', 'class'],
      th: ['colspan', 'rowspan', 'style', 'class'],
    },
    // sanitize-html：剥离不在 allowedAttributes 中的 on* 等不安全属性
    allowedSchemes: ['http', 'https', 'mailto'],
    // 允许 style 标签以支持 .md 中的 <style>；script/iframe 等仍不可执行
    allowVulnerableTags: true,
  });
}
