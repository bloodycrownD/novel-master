/**
 * `<file>` block rendering for workplace display output.
 *
 * @module domain/workplace/workplace-display
 */

import { formatLocalDateTime } from "@/infra/date-format.js";
import type { DisplayState } from "../model/workplace-types.js";
import { parseMarkdownFrontMatter } from "./front-matter.js";

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/**
 * Formats epoch ms as local `yyyy-MM-dd HH:mm:ss`.
 */
export function formatLocalMtime(mtimeMs: number): string {
  return formatLocalDateTime(mtimeMs);
}

function basename(logicalPath: string): string {
  const idx = logicalPath.lastIndexOf("/");
  return idx >= 0 ? logicalPath.slice(idx + 1) : logicalPath;
}

function contentLines(
  display: DisplayState,
  logicalPath: string,
  content: string,
): string[] {
  switch (display) {
    case "full": {
      const lines = content.split(/\r?\n/);
      if (lines.length === 1 && lines[0] === "") {
        return [];
      }
      return lines.map((line, idx) => `${idx + 1}|${line}`);
    }
    case "filename":
      return [`1|${basename(logicalPath)}`];
    case "header":
      return parseMarkdownFrontMatter(content);
    default:
      return [];
  }
}

/**
 * 与 {@link renderFileBlock} 标签内正文同形的行号正文（无外层 `<file>` / 无 mtime 属性）。
 * 供消息增量 `userAttach` / `workplaceChange` JSON `content` 使用。
 */
export function renderFileBlockBody(params: {
  readonly logicalPath: string;
  readonly display: DisplayState;
  readonly content: string;
}): string {
  return contentLines(
    params.display,
    params.logicalPath,
    params.content,
  ).join("\n");
}

/** Renders a single visible file block. */
export function renderFileBlock(params: {
  readonly logicalPath: string;
  readonly mtimeMs: number;
  readonly display: DisplayState;
  readonly content: string;
}): string {
  const body = renderFileBlockBody({
    logicalPath: params.logicalPath,
    display: params.display,
    content: params.content,
  });
  const mtimeLocal = formatLocalMtime(params.mtimeMs);
  const attrs = [
    `path="${escapeXmlAttr(params.logicalPath)}"`,
    `createdAt="${escapeXmlAttr(mtimeLocal)}"`,
    `updatedAt="${escapeXmlAttr(mtimeLocal)}"`,
    `updatedBy="user"`,
  ].join(" ");
  return `<file ${attrs}>\n${body}\n</file>`;
}

/** Joins file blocks with a single blank line between blocks. */
export function joinFileBlocks(blocks: readonly string[]): string {
  return blocks.filter((b) => b.length > 0).join("\n\n");
}
