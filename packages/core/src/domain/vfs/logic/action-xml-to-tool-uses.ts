/**
 * 从 `<action name="…">` JSON 推导 tool 名与 input。
 *
 * @module domain/vfs/logic/action-xml-to-tool-uses
 */

export interface DerivedToolUseInput {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

const ACTION_TAG_RE =
  /<action\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/action>)/g;

const ATTR_RE = /(\w+)="([^"]*)"/g;

function parseAttrs(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of attrText.matchAll(ATTR_RE)) {
    attrs[match[1]!] = match[2]!;
  }
  return attrs;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function parseJsonBody(inner: string): Record<string, unknown> {
  const raw = unescapeXml(inner).trim();
  if (raw === "") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function deriveFromNamedAction(
  name: string,
  params: Record<string, unknown>,
): DerivedToolUseInput[] {
  switch (name) {
    case "write":
      return [
        {
          name: "write",
          input: {
            path: asString(params.path),
            content: asString(params.content),
          },
        },
      ];
    case "edit":
      return [
        {
          name: "edit",
          input: {
            path: asString(params.path),
            oldString: asString(params.oldString),
            newString: asString(params.newString),
          },
        },
      ];
    case "mkdir":
      return [
        {
          name: "fs",
          input: { command: `mkdir ${asString(params.path)}` },
        },
      ];
    case "delete": {
      const path = asString(params.path);
      const recursive = params.recursive === true || params.recursive === "true";
      return [
        {
          name: "fs",
          input: { command: recursive ? `rm -r ${path}` : `rm ${path}` },
        },
      ];
    }
    case "rename":
      return [
        {
          name: "fs",
          input: {
            command: `mv ${asString(params.from)} ${asString(params.to)}`,
          },
        },
      ];
    default:
      return [];
  }
}

/**
 * 解析 action XML 字符串，按序返回推导的 tool 名与 input（不含 id）。
 */
export function actionXmlToToolUses(actionXml: string): DerivedToolUseInput[] {
  const results: DerivedToolUseInput[] = [];
  for (const match of actionXml.matchAll(ACTION_TAG_RE)) {
    const attrs = parseAttrs(match[1] ?? "");
    const name = attrs.name ?? "";
    const params = parseJsonBody(match[2] ?? "");
    results.push(...deriveFromNamedAction(name, params));
  }
  return results;
}
