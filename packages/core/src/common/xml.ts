/**
 * XML 文本/属性转义与实体解码的唯一实现。
 *
 * 只处理字符串片段，不负责标签结构；action DSL 的结构解析在
 * `domain/vfs/logic/user-vfs-action-xml.ts`。
 *
 * @module common/xml
 */

// 用 Map 而不是对象字面量：`&constructor;` / `&toString;` 会命中 Object.prototype
// 上的同名属性，对象索引查表会把这些未知 entity 解成原生函数源码。
const XML_ENTITY_MAP = new Map<string, string>([
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["amp", "&"],
  ["nbsp", "\u00a0"],
  ["ldquo", "“"],
  ["rdquo", "”"],
  ["lsquo", "‘"],
  ["rsquo", "’"],
  ["hellip", "…"],
  ["mdash", "—"],
  ["ndash", "–"],
]);

const XML_ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]+);/g;

/** XML 文本节点转义；属性值在此基础上再转双引号。 */
export function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 双引号包裹的 XML 属性值转义。 */
export function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

/** 解码 XML / 常见 HTML entity；未知 entity 原样保留。 */
export function unescapeXmlText(text: string): string {
  return text.replace(XML_ENTITY_RE, (match, body: string) => {
    if (!body.startsWith("#")) {
      return XML_ENTITY_MAP.get(body) ?? match;
    }
    const codePoint = body.startsWith("#x") ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
  });
}
