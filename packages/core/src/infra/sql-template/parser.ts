/**
 * SQL template parser (phase 1): lexical scan and AST construction.
 * Does not read runtime params; validates tag names, attributes, and nesting.
 */

import { Result } from "@/errors/either.js";
import { SqlTemplateError } from "./errors.js";
import type { AstNode, ForeachAttrs, TrimAttrs } from "./types.js";

const KNOWN_TAGS = new Set(["if", "where", "foreach", "trim", "choose", "when", "otherwise"]);

const OPEN_TAG_RE = /^(if|where|foreach|trim|choose|when|otherwise)\b/i;

const BIND_HASH_RE = /^#\{([^}]+)\}/;
const BIND_DOLLAR_RE = /^\$\{([^}]+)\}/;

interface ParsedAttribute {
    value: string;
    valueOffset: number;
}

/**
 * 模板 → AST 的词法扫描与构造（TemplateParser 的解析内核）。
 */
export const SqlTemplateParse = {
    /**
   * Parses a SQL template string into an AST.
   */
    parseToAst(template: string): Result<AstNode[], SqlTemplateError> {
        const pos = { value: 0 };
        const parsed = SqlTemplateParse.parseChildren(template, pos, null);
        if (!parsed.ok) return Result.err(parsed.error);
        if (pos.value < template.length) {
            return Result.err(new SqlTemplateError("UNCLOSED_TAG", "Unexpected trailing content", {
                offset: pos.value,
            }));
        }
        return Result.ok(parsed.value);
    },

    parseChildren(template: string, pos: { value: number }, closeTag: string | null): Result<AstNode[], SqlTemplateError> {
        const nodes: AstNode[] = [];

        while (pos.value < template.length) {
            const closed = SqlTemplateParse.parseNodesUntilClose(template, pos, closeTag, nodes);
            if (!closed.ok) return Result.err(closed.error);
            if (closed.value) return Result.ok(nodes);
        }

        if (closeTag !== null) {
            return Result.err(new SqlTemplateError("UNCLOSED_TAG", `Unclosed tag <${closeTag}>`, {
                offset: pos.value,
                tagName: closeTag,
            }));
        }

        return Result.ok(nodes);
    },

    /** nm-style: keep-local — 与 parseChildren 互为递归的词法扫描阶段，共享 pos 游标与 nodes 累积器。 */
    parseNodesUntilClose(template: string, pos: { value: number }, closeTag: string | null, nodes: AstNode[]): Result<boolean, SqlTemplateError> {
        const i = pos.value;
        const hash = template.indexOf("#{", i);
        const dollar = template.indexOf("${", i);
        let lt = template.indexOf("<", i);
        while (lt !== -1) {
            const tagStart = template.startsWith("</", lt) || OPEN_TAG_RE.test(template.slice(lt + 1)) || /^(\w+)(\s+[\w-]+=|\s*>)/.exec(template.slice(lt + 1)) !== null;
            if (tagStart) break;
            lt = template.indexOf("<", lt + 1);
        }

        let next = template.length;
        if (lt !== -1) next = Math.min(next, lt);
        if (hash !== -1) next = Math.min(next, hash);
        if (dollar !== -1) next = Math.min(next, dollar);

        if (next > i) {
            nodes.push({ type: "text", value: template.slice(i, next) });
            pos.value = next;
            return Result.ok(false);
        }

        if (next >= template.length) {
            return Result.ok(true);
        }

        const start = next;

        if (template.startsWith("#{", start)) {
            const m = BIND_HASH_RE.exec(template.slice(start));
            if (!m) {
                return Result.err(new SqlTemplateError("MALFORMED_TAG", "Unclosed #{ binding", {
                    offset: start,
                }));
            }
            nodes.push({ type: "bind", kind: "hash", path: m[1].trim() });
            pos.value = start + m[0].length;
            return Result.ok(false);
        }

        if (template.startsWith("${", start)) {
            const m = BIND_DOLLAR_RE.exec(template.slice(start));
            if (!m) {
                return Result.err(new SqlTemplateError("MALFORMED_TAG", "Unclosed ${ binding", {
                    offset: start,
                }));
            }
            nodes.push({ type: "bind", kind: "dollar", path: m[1].trim() });
            pos.value = start + m[0].length;
            return Result.ok(false);
        }

        if (template[start] !== "<") {
            nodes.push({ type: "text", value: template[start] });
            pos.value = start + 1;
            return Result.ok(false);
        }

        if (template.startsWith("</", start)) {
            const close = SqlTemplateParse.readCloseTag(template, start);
            if (!close.ok) return Result.err(close.error);
            pos.value = close.value.end;
            if (closeTag === null) {
                return Result.err(new SqlTemplateError("MALFORMED_TAG", `Unexpected closing tag </${close.value.name}>`, { offset: start, tagName: close.value.name }));
            }
            if (close.value.name.toLowerCase() !== closeTag.toLowerCase()) {
                return Result.err(new SqlTemplateError("MALFORMED_TAG", `Mismatched closing tag: expected </${closeTag}>, got </${close.value.name}>`, { offset: start, tagName: close.value.name }));
            }
            return Result.ok(true);
        }

        const tagProbe = template.slice(start + 1);
        const openMatch = OPEN_TAG_RE.exec(tagProbe);
        if (!openMatch) {
            const unknown = /^(\w+)(\s+[\w-]+=|\s*>)/.exec(tagProbe);
            if (unknown && !KNOWN_TAGS.has(unknown[1].toLowerCase())) {
                return Result.err(new SqlTemplateError("UNKNOWN_TAG", `Unknown tag <${unknown[1]}>`, {
                    offset: start,
                    tagName: unknown[1],
                }));
            }
            nodes.push({ type: "text", value: "<" });
            pos.value = start + 1;
            return Result.ok(false);
        }

        const tagName = openMatch[1].toLowerCase();

        if (tagName === "when" || tagName === "otherwise") {
            return Result.err(new SqlTemplateError("MALFORMED_TAG", `<${tagName}> must appear inside <choose>`, { offset: start, tagName }));
        }

        const opened = SqlTemplateParse.readOpenTagHeader(template, start, tagName);
        if (!opened.ok) return Result.err(opened.error);
        const { attrs, bodyStart } = opened.value;
        pos.value = bodyStart;

        switch (tagName) {
            case "if": {
                const test = SqlTemplateParse.requireAttr(attrs, "test", tagName, start);
                if (!test.ok) return Result.err(test.error);
                const children = SqlTemplateParse.parseChildren(template, pos, tagName);
                if (!children.ok) return Result.err(children.error);
                nodes.push({ type: "if", test: test.value.value, testOffset: test.value.valueOffset, children: children.value });
                return Result.ok(false);
            }
            case "where": {
                const children = SqlTemplateParse.parseChildren(template, pos, tagName);
                if (!children.ok) return Result.err(children.error);
                nodes.push({ type: "where", children: children.value });
                return Result.ok(false);
            }
            case "foreach": {
                const collection = SqlTemplateParse.requireAttr(attrs, "collection", tagName, start);
                if (!collection.ok) return Result.err(collection.error);
                const item = SqlTemplateParse.requireAttr(attrs, "item", tagName, start);
                if (!item.ok) return Result.err(item.error);
                const foreachAttrs: ForeachAttrs = {
                    collection: collection.value.value,
                    item: item.value.value,
                    index: attrs.get("index")?.value,
                    open: attrs.get("open")?.value,
                    close: attrs.get("close")?.value,
                    separator: attrs.get("separator")?.value,
                };
                const children = SqlTemplateParse.parseChildren(template, pos, tagName);
                if (!children.ok) return Result.err(children.error);
                nodes.push({ type: "foreach", attrs: foreachAttrs, children: children.value });
                return Result.ok(false);
            }
            case "trim": {
                const trimAttrs: TrimAttrs = {
                    prefix: attrs.get("prefix")?.value,
                    suffix: attrs.get("suffix")?.value,
                    prefixOverrides: attrs.get("prefixoverrides")?.value,
                    suffixOverrides: attrs.get("suffixoverrides")?.value,
                };
                const children = SqlTemplateParse.parseChildren(template, pos, tagName);
                if (!children.ok) return Result.err(children.error);
                nodes.push({ type: "trim", attrs: trimAttrs, children: children.value });
                return Result.ok(false);
            }
            case "choose": {
                const whens: { test: string; testOffset?: number; children: AstNode[] }[] = [];
                let otherwise: AstNode[] | undefined;

                while (pos.value < template.length) {
                    if (template.startsWith("</choose>", pos.value)) {
                        pos.value += "</choose>".length;
                        nodes.push({ type: "choose", whens, otherwise });
                        return Result.ok(false);
                    }

                    const tagStart = pos.value;
                    if (!template.startsWith("<", tagStart)) {
                        return Result.err(new SqlTemplateError("MALFORMED_TAG", "Only <when> and <otherwise> allowed inside <choose>", { offset: tagStart }));
                    }

                    const probe = template.slice(tagStart + 1);
                    const whenMatch = /^when\b/i.exec(probe);
                    const otherwiseMatch = /^otherwise\b/i.exec(probe);

                    if (whenMatch) {
                        const whenOpened = SqlTemplateParse.readOpenTagHeader(template, tagStart, "when");
                        if (!whenOpened.ok) return Result.err(whenOpened.error);
                        const testAttr = SqlTemplateParse.requireAttr(whenOpened.value.attrs, "test", "when", tagStart);
                        if (!testAttr.ok) return Result.err(testAttr.error);
                        pos.value = whenOpened.value.bodyStart;
                        const children = SqlTemplateParse.parseChildren(template, pos, "when");
                        if (!children.ok) return Result.err(children.error);
                        whens.push({
                            test: testAttr.value.value,
                            testOffset: testAttr.value.valueOffset,
                            children: children.value,
                        });
                        continue;
                    }

                    if (otherwiseMatch) {
                        if (otherwise !== undefined) {
                            return Result.err(new SqlTemplateError("MALFORMED_TAG", "Duplicate <otherwise> in <choose>", { offset: tagStart }));
                        }
                        const otherwiseOpened = SqlTemplateParse.readOpenTagHeader(template, tagStart, "otherwise");
                        if (!otherwiseOpened.ok) return Result.err(otherwiseOpened.error);
                        pos.value = otherwiseOpened.value.bodyStart;
                        const children = SqlTemplateParse.parseChildren(template, pos, "otherwise");
                        if (!children.ok) return Result.err(children.error);
                        otherwise = children.value;
                        continue;
                    }

                    if (template.startsWith("</", tagStart)) {
                        const close = SqlTemplateParse.readCloseTag(template, tagStart);
                        if (!close.ok) return Result.err(close.error);
                        if (close.value.name.toLowerCase() === "choose") {
                            pos.value = close.value.end;
                            nodes.push({ type: "choose", whens, otherwise });
                            return Result.ok(false);
                        }
                    }

                    const unknownChild = OPEN_TAG_RE.exec(probe);
                    if (unknownChild) {
                        return Result.err(new SqlTemplateError("MALFORMED_TAG", `Invalid child <${unknownChild[1]}> inside <choose>`, { offset: tagStart, tagName: unknownChild[1] }));
                    }

                    return Result.err(new SqlTemplateError("UNKNOWN_TAG", "Unknown tag inside <choose>", {
                        offset: tagStart,
                    }));
                }

                return Result.err(new SqlTemplateError("UNCLOSED_TAG", "Unclosed <choose>", {
                    offset: start,
                    tagName: "choose",
                }));
            }
            default:
                return Result.err(new SqlTemplateError("UNKNOWN_TAG", `Unknown tag <${tagName}>`, {
                    offset: start,
                    tagName,
                }));
        }
    },

    readCloseTag(template: string, offset: number): Result<{ name: string; end: number }, SqlTemplateError> {
        const m = /^<\/(\w+)\s*>/.exec(template.slice(offset));
        if (!m) {
            return Result.err(new SqlTemplateError("MALFORMED_TAG", "Invalid closing tag", {
                offset,
            }));
        }
        return Result.ok({ name: m[1], end: offset + m[0].length });
    },

    readOpenTagHeader(template: string, offset: number, tagName: string): Result<{ attrs: Map<string, ParsedAttribute>; bodyStart: number }, SqlTemplateError> {
        const headerStart = offset + 1 + tagName.length;
        const gt = template.indexOf(">", headerStart);
        if (gt === -1) {
            return Result.err(new SqlTemplateError("UNCLOSED_TAG", `Unclosed <${tagName}>`, {
                offset,
                tagName,
            }));
        }
        const header = template.slice(headerStart, gt);
        const attrs = new Map<string, ParsedAttribute>();
        const attrRe = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(header)) !== null) {
      const quoteIdx = m[0].search(/["']/);
      const valueOffset = headerStart + m.index + quoteIdx;
      attrs.set(m[1].toLowerCase(), {
        value: m[2] ?? m[3] ?? "",
        valueOffset,
      });
    }
    if (header.trim() && attrs.size === 0 && /\S/.test(header)) {
      return Result.err(new SqlTemplateError("MALFORMED_TAG", `Malformed attributes on <${tagName}>`, { offset, tagName }));
    }
    return Result.ok({ attrs, bodyStart: gt + 1 });
  },

  requireAttr(attrs: Map<string, ParsedAttribute>, name: string, tagName: string, offset: number): Result<ParsedAttribute, SqlTemplateError> {
    const val = attrs.get(name);
    if (val === undefined) {
      return Result.err(new SqlTemplateError("MALFORMED_TAG", `Missing required attribute "${name}" on <${tagName}>`, { offset, tagName }));
    }
    return Result.ok(val);
  },
} as const;

/**
 * Stateful template parser (reusable, no options).
 *
 * 同一段模板字符串反复解析纯属浪费——解析是纯函数，输入相同则 AST 必然相同，
 * 所以这里按模板字符串原文缓存一份 AST，命中就直接返回，省掉重复的词法扫描
 * 和 AST 构造。模板字符串通常数量有限（来自配置），缓存增长可控，不需要 LRU。
 */
export class TemplateParser {
  private readonly astCache = new Map<string, AstNode[]>();

  parse(template: string): Result<AstNode[], SqlTemplateError> {
    const cached = this.astCache.get(template);
    if (cached !== undefined) return Result.ok(cached);
    const ast = SqlTemplateParse.parseToAst(template);
    if (!ast.ok) return ast;
    this.astCache.set(template, ast.value);
    return ast;
  }
}
