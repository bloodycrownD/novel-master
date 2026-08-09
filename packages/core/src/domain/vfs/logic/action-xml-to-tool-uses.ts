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

/**
 * 常见 HTML entity → 字符映射。
 *
 * LLM 偷懒时会用 `&ldquo; &rdquo;` 之类的 HTML entity 来转义中文引号，
 * 但协议只规定 XML entity（`&lt; &gt; &quot; &amp;`）。如果不在这里拦一下，
 * entity 会原样透传给 vfs，导致 oldString 里带的是字面 `&ldquo;` 而文件里是“，
 * edit 当然就匹配不上了。不引外部依赖，只枚举这一组就够覆盖典型场景了。
 */
const HTML_ENTITY_MAP: ReadonlyMap<string, string> = new Map<string, string>([
  ["&ldquo;", "“"],
  ["&rdquo;", "”"],
  ["&lsquo;", "‘"],
  ["&rsquo;", "’"],
  ["&nbsp;", "\u00a0"],
  ["&hellip;", "…"],
  ["&mdash;", "—"],
  ["&ndash;", "–"],
]);

const HTML_ENTITY_RE = /&(?:ldquo|rdquo|lsquo|rsquo|nbsp|hellip|mdash|ndash);/g;

function parseAttrs(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of attrText.matchAll(ATTR_RE)) {
    attrs[match[1]!] = match[2]!;
  }
  return attrs;
}

function unescapeXml(text: string): string {
  // 先解 HTML entity，再解 XML entity；最后解 &amp;，避免把上面解出来的 & 二次反转。
  let result = text.replace(HTML_ENTITY_RE, (match) => {
    return HTML_ENTITY_MAP.get(match) ?? match;
  });
  result = result
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"");
  // &amp; 必须放在最后，否则前面替换出来的 & 又会被错认成实体前缀。
  return result.replace(/&amp;/g, "&");
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
          input: { action: "mkdir", path: asString(params.path) },
        },
      ];
    case "delete": {
      const path = asString(params.path);
      const recursive = params.recursive === true || params.recursive === "true";
      return [
        {
          name: "fs",
          input: { action: "rm", path, recursive },
        },
      ];
    }
    case "rename":
    case "move":
      // 协议 rename|move 均映射 VFS `mv`（同目录 / 跨目录由 action 名区分）。
      return [
        {
          name: "fs",
          input: {
            action: "mv",
            from: asString(params.from),
            to: asString(params.to),
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
