/**
 * Normalizes GitHub release tag_name to a semver string (strips leading `v`).
 */

const TAG_PATTERN = /^v?(\d+\.\d+\.\d+)(?:[-+].*)?$/;

export function parseReleaseTag(tagName: string): string {
  const trimmed = tagName.trim();
  const match = TAG_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error(`无法解析版本标签: ${tagName}`);
  }
  return match[1]!;
}
