/**
 * `<file>` block rendering for workplace display output.
 *
 * @module domain/workplace/workplace-display
 */

import { Xml } from "@/common/xml.js";
import { DateTime } from "@/common/datetime.js";
import type { DisplayState } from "../model/workplace-types.js";
import { FrontMatter } from "./front-matter.js";

export const WorkplaceDisplay = {
    /**
   * 与 {@link WorkplaceDisplay.renderFileBlock} 标签内正文同形的行号正文（无外层 `<file>` / 无 mtime 属性）。
   * 供消息增量 `userAttach` / `workplaceChange` JSON `content` 使用。
   */
    renderFileBlockBody(params: { readonly logicalPath: string; readonly display: DisplayState; readonly content: string }): string {
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
                return FrontMatter.parseMarkdown(params.content).join("\n");
            default:
                return "";
        }
    },

    /** Renders a single visible file block. */
    renderFileBlock(params: { readonly logicalPath: string; readonly mtimeMs: number; readonly display: DisplayState; readonly content: string }): string {
        const body = WorkplaceDisplay.renderFileBlockBody({
            logicalPath: params.logicalPath,
            display: params.display,
            content: params.content,
        });
        const mtimeLocal = DateTime.localDateTime(params.mtimeMs);
        const attrs = [`path="${Xml.escapeAttr(params.logicalPath)}"`, `createdAt="${Xml.escapeAttr(mtimeLocal)}"`, `updatedAt="${Xml.escapeAttr(mtimeLocal)}"`, `updatedBy="user"`].join(" ");
        return `<file ${attrs}>\n${body}\n</file>`;
    },

    /** Joins file blocks with a single blank line between blocks. */
    joinFileBlocks(blocks: readonly string[]): string {
        return blocks.filter((b) => b.length > 0).join("\n\n");
    },
} as const;
