/**
 * Markdown front matter extraction for worktree display.
 *
 * @module domain/worktree/front-matter
 */

const FRONT_MATTER_START = /^---\s*$/;
const FRONT_MATTER_END = /^---\s*$/;

/** Result of splitting a Markdown file into optional front matter and body. */
export interface MarkdownFrontMatterSplit {
  /** Lines between opening and closing `---` (excludes delimiters). */
  frontMatterLines: string[] | null;
  /** Markdown body after the closing delimiter, or full file when no front matter. */
  body: string;
  /** `false` when an opening `---` has no closing `---`. */
  closed: boolean;
}

/**
 * Splits YAML front matter between `---` lines from the Markdown body.
 */
export function splitMarkdownFrontMatter(content: string): MarkdownFrontMatterSplit {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0 || !FRONT_MATTER_START.test(lines[0] ?? "")) {
    return { frontMatterLines: null, body: content, closed: true };
  }
  const frontMatterLines: string[] = [];
  let closed = false;
  let endIndex = 1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FRONT_MATTER_END.test(line)) {
      closed = true;
      endIndex = i + 1;
      break;
    }
    frontMatterLines.push(line);
  }
  if (!closed) {
    return { frontMatterLines, body: content, closed: false };
  }
  const body = lines.slice(endIndex).join("\n");
  return { frontMatterLines, body, closed: true };
}

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
  if (!split.closed) {
    return ["1|（Front Matter 格式无效）"];
  }
  if (split.frontMatterLines.length === 0) {
    return ["1|（空 Front Matter）"];
  }
  return split.frontMatterLines.map((line, idx) => `${idx + 1}|${line}`);
}
