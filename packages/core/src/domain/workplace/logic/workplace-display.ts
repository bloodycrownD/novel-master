/**
 * `<file>` block rendering for workplace display output.
 *
 * @module domain/workplace/workplace-display
 */

import { Xml } from "@/common/xml.js";
import { formatLocalDateTime } from "@/infra/date-format.js";
import type { DisplayState } from "../model/workplace-types.js";
import { parseMarkdownFrontMatter } from "./front-matter.js";

/**
 * Formats epoch ms as local `yyyy-MM-dd HH:mm:ss`.
 *
 * nm-style: keep-public — `public/workplace.ts` 仍导出该兼容别名，撤除需同步
 * public barrel（本轮只改 domain 范围）；实现已是 infra 单源 `formatLocalDateTime`。
 */
export function formatLocalMtime(mtimeMs: number): string {
  return formatLocalDateTime(mtimeMs);
}

/**
 * 与 {@link renderFileBlock} 标签内正文同形的行号正文（无外层 `<file>` / 无 mtime 属性）。
 * 供消息增量 `userAttach` / `workplaceChange` JSON `content` 使用。
 */
export function renderFileBlockBody(params: { readonly logicalPath: string; readonly display: DisplayState; readonly content: string }): string {
  switch (params.display) {
    case "full": {
      const lines = params.content.split(/\r?\n/);
      if (lines.length === 1 && lines[0] === "") {
        return "";
      }
      return lines.map((line, idx) => `${idx + 1}|${line}`).join("\n");
    }
    case "filename": {
      const idx = params.logicalPath.lastIndexOf("/");
      return `1|${idx >= 0 ? params.logicalPath.slice(idx + 1) : params.logicalPath}`;
    }
    case "header":
      return parseMarkdownFrontMatter(params.content).join("\n");
    default:
      return "";
  }
}

/** Renders a single visible file block. */
export function renderFileBlock(params: { readonly logicalPath: string; readonly mtimeMs: number; readonly display: DisplayState; readonly content: string }): string {
  const body = renderFileBlockBody({
    logicalPath: params.logicalPath,
    display: params.display,
    content: params.content,
  });
  const mtimeLocal = formatLocalMtime(params.mtimeMs);
  const attrs = [`path="${Xml.escapeAttr(params.logicalPath)}"`, `createdAt="${Xml.escapeAttr(mtimeLocal)}"`, `updatedAt="${Xml.escapeAttr(mtimeLocal)}"`, `updatedBy="user"`].join(" ");
  return `<file ${attrs}>\n${body}\n</file>`;
}

/** Joins file blocks with a single blank line between blocks. */
export function joinFileBlocks(blocks: readonly string[]): string {
  return blocks.filter((b) => b.length > 0).join("\n\n");
}
