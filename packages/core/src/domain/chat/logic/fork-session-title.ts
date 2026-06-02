/**
 * Forked session title: `{sourceTitle}_ckpt_{n}`.
 *
 * @module domain/chat/logic/fork-session-title
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Next unused fork title for a source session name within a project.
 *
 * @example `新会话1` → `新会话1_ckpt_1`, then `新会话1_ckpt_2`
 */
export function nextForkSessionTitle(
  sourceTitle: string | null | undefined,
  existingTitles: ReadonlyArray<string | null | undefined>,
): string {
  const base = sourceTitle?.trim() || "会话";
  const re = new RegExp(`^${escapeRegExp(base)}_ckpt_(\\d+)$`);
  let max = 0;
  for (const raw of existingTitles) {
    if (raw == null || raw === "") {
      continue;
    }
    const match = raw.match(re);
    if (match) {
      max = Math.max(max, Number.parseInt(match[1]!, 10));
    }
  }
  return `${base}_ckpt_${max + 1}`;
}
