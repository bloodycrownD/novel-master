/**
 * Markdown front matter extraction for worktree display.
 *
 * @module domain/worktree/front-matter
 */

const FRONT_MATTER_START = /^---\s*$/;
const FRONT_MATTER_END = /^---\s*$/;

/**
 * Parses YAML front matter between `---` lines.
 *
 * @returns Display lines (`lineNo|content`) or PRD fallback on failure.
 */
export function parseMarkdownFrontMatter(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0 || !FRONT_MATTER_START.test(lines[0] ?? "")) {
    return ["1|（无 Front Matter）"];
  }
  const body: string[] = [];
  let closed = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FRONT_MATTER_END.test(line)) {
      closed = true;
      break;
    }
    body.push(line);
  }
  if (!closed) {
    return ["1|（Front Matter 格式无效）"];
  }
  if (body.length === 0) {
    return ["1|（空 Front Matter）"];
  }
  return body.map((line, idx) => `${idx + 1}|${line}`);
}
