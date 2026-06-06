/**
 * Jest shim for `@novel-master/core/front-matter` (avoids core barrel in tests).
 */

const FRONT_MATTER_START = /^---\s*$/;
const FRONT_MATTER_END = /^---\s*$/;

export interface MarkdownFrontMatterSplit {
  frontMatterLines: string[] | null;
  body: string;
  closed: boolean;
}

export function splitMarkdownFrontMatter(
  content: string,
): MarkdownFrontMatterSplit {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0 || !FRONT_MATTER_START.test(lines[0] ?? '')) {
    return {frontMatterLines: null, body: content, closed: true};
  }
  const frontMatterLines: string[] = [];
  let closed = false;
  let endIndex = 1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (FRONT_MATTER_END.test(line)) {
      closed = true;
      endIndex = i + 1;
      break;
    }
    frontMatterLines.push(line);
  }
  if (!closed) {
    return {frontMatterLines, body: content, closed: false};
  }
  const body = lines.slice(endIndex).join('\n');
  return {frontMatterLines, body, closed: true};
}
