/**
 * `<file>` block rendering for worktree display output.
 *
 * @module domain/worktree/worktree-display
 */

import type { DisplayState } from "./model/worktree-types.js";
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
  const d = new Date(mtimeMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

/** Renders a single visible file block. */
export function renderFileBlock(params: {
  readonly logicalPath: string;
  readonly mtimeMs: number;
  readonly display: DisplayState;
  readonly content: string;
}): string {
  const lines = contentLines(params.display, params.logicalPath, params.content);
  const mtimeLocal = formatLocalMtime(params.mtimeMs);
  const attrs = [
    `path="${escapeXmlAttr(params.logicalPath)}"`,
    `createdAt="${escapeXmlAttr(mtimeLocal)}"`,
    `updatedAt="${escapeXmlAttr(mtimeLocal)}"`,
    `updatedBy="user"`,
  ].join(" ");
  const body = lines.join("\n");
  return `<file ${attrs}>\n${body}\n</file>`;
}

/** Joins file blocks with a single blank line between blocks. */
export function joinFileBlocks(blocks: readonly string[]): string {
  return blocks.filter((b) => b.length > 0).join("\n\n");
}
