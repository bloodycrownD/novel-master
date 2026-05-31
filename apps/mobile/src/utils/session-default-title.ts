/** Default session title prefix for auto-numbered names (`新会话1`, `新会话2`, …). */
export const DEFAULT_SESSION_TITLE_PREFIX = '新会话';

const NUMBERED_TITLE_RE = /^新会话(\d+)$/;

/**
 * Next unused default session title within a project.
 */
export function nextDefaultSessionTitle(
  existingTitles: ReadonlyArray<string | null | undefined>,
): string {
  const used = new Set<number>();
  for (const raw of existingTitles) {
    if (raw == null || raw === '') {
      continue;
    }
    const match = raw.match(NUMBERED_TITLE_RE);
    if (match) {
      used.add(Number.parseInt(match[1]!, 10));
    }
  }
  let n = 1;
  while (used.has(n)) {
    n += 1;
  }
  return `${DEFAULT_SESSION_TITLE_PREFIX}${n}`;
}
