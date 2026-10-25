/**
 * 用户 VFS action XML 的唯一 codec：`<action name="…">JSON</action>`。
 *
 * 结构化解析统一走 `fast-xml-parser`，避免各调用点各写一套正则与 entity 规则。
 *
 * @module domain/vfs/logic/user-vfs-action-xml
 */

import { XMLParser } from "fast-xml-parser";
import { escapeXmlAttr, escapeXmlText, unescapeXmlText } from "@/common/xml.js";

type ParsedUserVfsActionElement = {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly params: Record<string, unknown>;
};

const actionParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  preserveOrder: true,
  stopNodes: ["*.action"],
});

/** 通用 action XML：`<action name="…">{json}</action>`。 */
export function buildUserVfsActionXml(name: string, params: Record<string, unknown>): string {
  const body = escapeXmlText(JSON.stringify(params, null, 2));
  return `<action name="${escapeXmlAttr(name)}">\n${body}\n</action>`;
}

/** 解析文本中全部 action；非法 XML 或非法 JSON 按空参数处理。 */
export function parseUserVfsActionsFromText(text: string): readonly ParsedUserVfsActionElement[] {
  if (!text.includes("<action")) {
    return [];
  }
  let document: unknown;
  try {
    document = actionParser.parse(`<root>${text}</root>`);
  } catch {
    return [];
  }
  const parsed: ParsedUserVfsActionElement[] = [];
  walkActions(document, parsed);
  return parsed;
}

/** nm-style: keep-local — XML 树遍历与 action 节点提取是 codec 的单一解析阶段。 */
function walkActions(nodes: unknown, parsed: ParsedUserVfsActionElement[]): void {
  if (!Array.isArray(nodes)) {
    return;
  }
  for (const node of nodes) {
    if (node == null || typeof node !== "object" || Array.isArray(node)) {
      continue;
    }
    const record = node as Record<string, unknown>;
    const children = record.action;
    if (Array.isArray(children)) {
      const attrs: Record<string, string> = {};
      const rawAttrs = record[":@"];
      if (rawAttrs != null && typeof rawAttrs === "object" && !Array.isArray(rawAttrs)) {
        for (const [key, value] of Object.entries(rawAttrs)) {
          if (typeof value === "string") {
            attrs[key] = unescapeXmlText(value);
          }
        }
      }
      const name = attrs.name ?? "";
      if (name !== "") {
        const body = children.find((child) => child != null && typeof child === "object" && typeof (child as Record<string, unknown>)["#text"] === "string");
        const rawBody = body == null ? "" : String((body as Record<string, unknown>)["#text"]);
        const raw = unescapeXmlText(rawBody).trim();
        let params: Record<string, unknown> = {};
        if (raw !== "") {
          try {
            const value: unknown = JSON.parse(raw);
            if (value != null && typeof value === "object" && !Array.isArray(value)) {
              params = value as Record<string, unknown>;
            }
          } catch {
            // 非法 JSON 按空参数处理
          }
        }
        parsed.push({ name, attrs, params });
      }
      continue;
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        walkActions(value, parsed);
      }
    }
  }
}
