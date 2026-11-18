/**
 * Markdown front matter display formatting for workplace file blocks.
 *
 * @module domain/workplace/front-matter
 */

import { splitMarkdownFrontMatter } from "@/common/front-matter.js";

/**
 * Parses YAML front matter between `---` lines.
 *
 * @returns Display lines (`lineNo|content`) or PRD fallback on failure.
 */
export function parseMarkdownFrontMatter(content: string): string[] {
  const split = splitMarkdownFrontMatter(content);
  if (split.frontMatterLines === null) {
    return ["1|（无 Front Matter）"];
  }
  if (split.frontMatterLines.length === 0) {
    return ["1|（空 Front Matter）"];
  }
  return split.frontMatterLines.map((line, idx) => `${idx + 1}|${line}`);
}
