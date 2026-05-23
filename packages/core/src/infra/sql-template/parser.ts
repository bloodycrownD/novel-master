/**
 * SQL template parser (phase 1): lexical scan and AST construction.
 * Does not read runtime params; validates tag names, attributes, and nesting.
 */

import { SqlTemplateError } from "./errors.js";
import type { AstNode, ForeachAttrs, TrimAttrs } from "./types.js";

const KNOWN_TAGS = new Set([
  "if",
  "where",
  "foreach",
  "trim",
  "choose",
  "when",
  "otherwise",
]);

const OPEN_TAG_RE =
  /^(if|where|foreach|trim|choose|when|otherwise)\b/i;

const BIND_HASH_RE = /^#\{([^}]+)\}/;
const BIND_DOLLAR_RE = /^\$\{([^}]+)\}/;

/**
 * Parses a SQL template string into an AST.
 */
export function parseTemplateToAst(template: string): AstNode[] {
  const pos = { value: 0 };
  const nodes = parseChildren(template, pos, null);
  if (pos.value < template.length) {
    throw new SqlTemplateError("UNCLOSED_TAG", "Unexpected trailing content", {
      offset: pos.value,
    });
  }
  return nodes;
}

/**
 * Stateful template parser (reusable, no options).
 */
export class TemplateParser {
  parse(template: string): AstNode[] {
    return parseTemplateToAst(template);
  }
}

function parseChildren(
  template: string,
  pos: { value: number },
  closeTag: string | null,
): AstNode[] {
  const nodes: AstNode[] = [];

  while (pos.value < template.length) {
    const closed = parseNodesUntilClose(template, pos, closeTag, nodes);
    if (closed) return nodes;
  }

  if (closeTag !== null) {
    throw new SqlTemplateError(
      "UNCLOSED_TAG",
      `Unclosed tag <${closeTag}>`,
      { offset: pos.value, tagName: closeTag },
    );
  }

  return nodes;
}

function isTagStart(template: string, offset: number): boolean {
  if (template[offset] !== "<") return false;
  if (template.startsWith("</", offset)) return true;
  const probe = template.slice(offset + 1);
  if (OPEN_TAG_RE.test(probe)) return true;
  const unknown = /^(\w+)(\s+[\w-]+=|\s*>)/.exec(probe);
  return unknown !== null;
}

function parseNodesUntilClose(
  template: string,
  pos: { value: number },
  closeTag: string | null,
  nodes: AstNode[],
): boolean {
  const i = pos.value;
  const hash = template.indexOf("#{", i);
  const dollar = template.indexOf("${", i);
  let lt = template.indexOf("<", i);
  while (lt !== -1 && !isTagStart(template, lt)) {
    lt = template.indexOf("<", lt + 1);
  }

  let next = template.length;
  if (lt !== -1) next = Math.min(next, lt);
  if (hash !== -1) next = Math.min(next, hash);
  if (dollar !== -1) next = Math.min(next, dollar);

  if (next > i) {
    nodes.push({ type: "text", value: template.slice(i, next) });
    pos.value = next;
    return false;
  }

  if (next >= template.length) {
    return true;
  }

  const start = next;

  if (template.startsWith("#{", start)) {
    const m = BIND_HASH_RE.exec(template.slice(start));
    if (!m) {
      throw new SqlTemplateError("MALFORMED_TAG", "Unclosed #{ binding", {
        offset: start,
      });
    }
    nodes.push({ type: "bind", kind: "hash", path: m[1].trim() });
    pos.value = start + m[0].length;
    return false;
  }

  if (template.startsWith("${", start)) {
    const m = BIND_DOLLAR_RE.exec(template.slice(start));
    if (!m) {
      throw new SqlTemplateError("MALFORMED_TAG", "Unclosed ${ binding", {
        offset: start,
      });
    }
    nodes.push({ type: "bind", kind: "dollar", path: m[1].trim() });
    pos.value = start + m[0].length;
    return false;
  }

  if (template[start] !== "<") {
    nodes.push({ type: "text", value: template[start] });
    pos.value = start + 1;
    return false;
  }

  if (template.startsWith("</", start)) {
    const close = readCloseTag(template, start);
    pos.value = close.end;
    if (closeTag === null) {
      throw new SqlTemplateError(
        "MALFORMED_TAG",
        `Unexpected closing tag </${close.name}>`,
        { offset: start, tagName: close.name },
      );
    }
    if (close.name.toLowerCase() !== closeTag.toLowerCase()) {
      throw new SqlTemplateError(
        "MALFORMED_TAG",
        `Mismatched closing tag: expected </${closeTag}>, got </${close.name}>`,
        { offset: start, tagName: close.name },
      );
    }
    return true;
  }

  const tagProbe = template.slice(start + 1);
  const openMatch = OPEN_TAG_RE.exec(tagProbe);
  if (!openMatch) {
    const unknown = /^(\w+)(\s+[\w-]+=|\s*>)/.exec(tagProbe);
    if (unknown && !KNOWN_TAGS.has(unknown[1].toLowerCase())) {
      throw new SqlTemplateError(
        "UNKNOWN_TAG",
        `Unknown tag <${unknown[1]}>`,
        { offset: start, tagName: unknown[1] },
      );
    }
    nodes.push({ type: "text", value: "<" });
    pos.value = start + 1;
    return false;
  }

  const tagName = openMatch[1].toLowerCase();

  if (tagName === "when" || tagName === "otherwise") {
    throw new SqlTemplateError(
      "MALFORMED_TAG",
      `<${tagName}> must appear inside <choose>`,
      { offset: start,
      tagName },
    );
  }

  const node = parseOpenTag(template, pos, start, tagName);
  nodes.push(node);
  return false;
}

function readCloseTag(
  template: string,
  offset: number,
): { name: string; end: number } {
  const m = /^<\/(\w+)\s*>/.exec(template.slice(offset));
  if (!m) {
    throw new SqlTemplateError("MALFORMED_TAG", "Invalid closing tag", {
      offset,
    });
  }
  return { name: m[1], end: offset + m[0].length };
}

function readOpenTagHeader(
  template: string,
  offset: number,
  tagName: string,
): { attrs: Map<string, string>; bodyStart: number } {
  const headerStart = offset + 1 + tagName.length;
  const gt = template.indexOf(">", headerStart);
  if (gt === -1) {
    throw new SqlTemplateError("UNCLOSED_TAG", `Unclosed <${tagName}>`, {
      offset,
      tagName,
    });
  }
  const header = template.slice(headerStart, gt);
  const attrs = parseAttributes(header, offset, tagName);
  return { attrs, bodyStart: gt + 1 };
}

function parseAttributes(
  header: string,
  offset: number,
  tagName: string,
): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrRe = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(header)) !== null) {
    attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? "");
  }
  if (header.trim() && attrs.size === 0 && /\S/.test(header)) {
    throw new SqlTemplateError(
      "MALFORMED_TAG",
      `Malformed attributes on <${tagName}>`,
      { offset, tagName },
    );
  }
  return attrs;
}

function requireAttr(
  attrs: Map<string, string>,
  name: string,
  tagName: string,
  offset: number,
): string {
  const val = attrs.get(name);
  if (val === undefined) {
    throw new SqlTemplateError(
      "MALFORMED_TAG",
      `Missing required attribute "${name}" on <${tagName}>`,
      { offset, tagName },
    );
  }
  return val;
}

function parseOpenTag(
  template: string,
  pos: { value: number },
  offset: number,
  tagName: string,
): AstNode {
  const { attrs, bodyStart } = readOpenTagHeader(template, offset, tagName);
  pos.value = bodyStart;

  switch (tagName) {
    case "if": {
      const test = requireAttr(attrs, "test", tagName, offset);
      const children = parseChildren(template, pos, tagName);
      return { type: "if", test, children };
    }
    case "where": {
      const children = parseChildren(template, pos, tagName);
      return { type: "where", children };
    }
    case "foreach": {
      const collection = requireAttr(attrs, "collection", tagName, offset);
      const item = requireAttr(attrs, "item", tagName, offset);
      const foreachAttrs: ForeachAttrs = {
        collection,
        item,
        index: attrs.get("index"),
        open: attrs.get("open"),
        close: attrs.get("close"),
        separator: attrs.get("separator"),
      };
      const children = parseChildren(template, pos, tagName);
      return { type: "foreach", attrs: foreachAttrs, children };
    }
    case "trim": {
      const trimAttrs: TrimAttrs = {
        prefix: attrs.get("prefix"),
        suffix: attrs.get("suffix"),
        prefixOverrides: attrs.get("prefixoverrides"),
        suffixOverrides: attrs.get("suffixoverrides"),
      };
      const children = parseChildren(template, pos, tagName);
      return { type: "trim", attrs: trimAttrs, children };
    }
    case "choose":
      return parseChooseBody(template, pos, offset);
    default:
      throw new SqlTemplateError("UNKNOWN_TAG", `Unknown tag <${tagName}>`, {
        offset,
        tagName,
      });
  }
}

function parseChooseBody(
  template: string,
  pos: { value: number },
  offset: number,
): AstNode {
  const whens: { test: string; children: AstNode[] }[] = [];
  let otherwise: AstNode[] | undefined;

  while (pos.value < template.length) {
    if (template.startsWith("</choose>", pos.value)) {
      pos.value += "</choose>".length;
      return { type: "choose", whens, otherwise };
    }

    const tagStart = pos.value;
    if (!template.startsWith("<", tagStart)) {
      throw new SqlTemplateError(
        "MALFORMED_TAG",
        "Only <when> and <otherwise> allowed inside <choose>",
        { offset: tagStart },
      );
    }

    const probe = template.slice(tagStart + 1);
    const whenMatch = /^when\b/i.exec(probe);
    const otherwiseMatch = /^otherwise\b/i.exec(probe);

    if (whenMatch) {
      const { attrs, bodyStart } = readOpenTagHeader(
        template,
        tagStart,
        "when",
      );
      const test = requireAttr(attrs, "test", "when", tagStart);
      pos.value = bodyStart;
      const children = parseChildren(template, pos, "when");
      whens.push({ test, children });
      continue;
    }

    if (otherwiseMatch) {
      if (otherwise !== undefined) {
        throw new SqlTemplateError(
          "MALFORMED_TAG",
          "Duplicate <otherwise> in <choose>",
          { offset: tagStart },
        );
      }
      const { bodyStart } = readOpenTagHeader(
        template,
        tagStart,
        "otherwise",
      );
      pos.value = bodyStart;
      otherwise = parseChildren(template, pos, "otherwise");
      continue;
    }

    if (template.startsWith("</", tagStart)) {
      const close = readCloseTag(template, tagStart);
      if (close.name.toLowerCase() === "choose") {
        pos.value = close.end;
        return { type: "choose", whens, otherwise };
      }
    }

    const openMatch = OPEN_TAG_RE.exec(probe);
    if (openMatch) {
      throw new SqlTemplateError(
        "MALFORMED_TAG",
        `Invalid child <${openMatch[1]}> inside <choose>`,
        { offset: tagStart, tagName: openMatch[1] },
      );
    }

    throw new SqlTemplateError("UNKNOWN_TAG", "Unknown tag inside <choose>", {
      offset: tagStart,
    });
  }

  throw new SqlTemplateError("UNCLOSED_TAG", "Unclosed <choose>", {
    offset,
    tagName: "choose",
  });
}
