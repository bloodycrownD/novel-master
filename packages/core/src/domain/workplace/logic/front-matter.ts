/**
 * Markdown front matter display formatting for workplace file blocks.
 *
 * @module domain/workplace/front-matter
 */

import { FrontMatter as MarkdownFrontMatter } from "@/common/front-matter.js";

export const FrontMatter = {
  /**
   * Parses YAML front matter between `---` lines.
   *
   * @returns Display lines (`lineNo|content`) or PRD fallback on failure.
   */
  parseMarkdown(content: string): string[] {
    const split = MarkdownFrontMatter.splitMarkdown(content);
    if (split.frontMatterLines === null) {
      return ["1|（无 Front Matter）"];
    }
    if (split.frontMatterLines.length === 0) {
      return ["1|（空 Front Matter）"];
    }
    return split.frontMatterLines.map((line, idx) => `${idx + 1}|${line}`);
  },
} as const;
