/**
 * 从 `<user-vfs-action>` XML 推导 tool 名与 input 结构（flush 压缩 tool_use 用）。
 *
 * @module domain/vfs/logic/action-xml-to-tool-uses
 */

export interface DerivedToolUseInput {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

const ACTION_TAG_RE =
  /<user-vfs-action\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/user-vfs-action>)/g;

const ATTR_RE = /(\w+)="([^"]*)"/g;

function parseAttrs(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of attrText.matchAll(ATTR_RE)) {
    attrs[match[1]!] = match[2]!;
  }
  return attrs;
}

function parseEditHunks(inner: string): Array<{ oldString: string; newString: string }> {
  const hunks: Array<{ oldString: string; newString: string }> = [];
  const hunkRe =
    /<edit-hunk[^>]*>[\s\S]*?<old>([\s\S]*?)<\/old>[\s\S]*?<new>([\s\S]*?)<\/new>[\s\S]*?<\/edit-hunk>/g;
  for (const match of inner.matchAll(hunkRe)) {
    hunks.push({
      oldString: unescapeXml(match[1] ?? ""),
      newString: unescapeXml(match[2] ?? ""),
    });
  }
  return hunks;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function deriveFromAction(
  attrs: Record<string, string>,
  inner: string,
): DerivedToolUseInput[] {
  const kind = attrs.kind;
  switch (kind) {
    case "delete": {
      const path = attrs.path ?? "";
      const command = attrs.recursive === "true" ? `rm -r ${path}` : `rm ${path}`;
      return [{ name: "fs", input: { command } }];
    }
    case "mkdir":
      return [{ name: "fs", input: { command: `mkdir ${attrs.path ?? ""}` } }];
    case "rename":
      return [
        {
          name: "fs",
          input: {
            command: `mv ${attrs.from ?? ""} ${attrs.to ?? ""}`,
          },
        },
      ];
    case "save": {
      const path = attrs.path ?? "";
      if (attrs.method === "write") {
        return [{ name: "write", input: { path, content: "" } }];
      }
      const hunks = parseEditHunks(inner);
      return hunks.map((hunk) => ({
        name: "edit",
        input: {
          path,
          oldString: hunk.oldString,
          newString: hunk.newString,
        },
      }));
    }
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
    const inner = match[2] ?? "";
    results.push(...deriveFromAction(attrs, inner));
  }
  return results;
}
