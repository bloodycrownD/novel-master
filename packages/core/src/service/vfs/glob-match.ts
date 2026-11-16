/**
 * Simple glob matcher for VFS paths (no third-party dependency).
 *
 * @module service/vfs/glob-match
 */

/**
 * Returns true when `path` matches `pattern`.
 *
 * Supports `*`, `**`, and `?`. Path and pattern use POSIX `/` segments.
 */
export function matchGlob(pattern: string, path: string): boolean {
  const trimmed = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  const patternSegments: string[] = [];
  for (const part of trimmed.split("/")) {
    if (part === "**") {
      if (patternSegments.at(-1) !== "**") {
        patternSegments.push("**");
      }
      continue;
    }
    patternSegments.push(part);
  }
  const pathSegments = path === "/" ? [] : path.split("/").filter(Boolean);

  return matchSegments(patternSegments, pathSegments, 0, 0);
}

// nm-style: keep-local — 回溯匹配的自递归函数：内联后 `**` / `*` 分支失去自身引用。
function matchSegments(pattern: string[], path: string[], pi: number, si: number): boolean {
  if (pi === pattern.length) {
    return si === path.length;
  }

  const segment = pattern[pi]!;

  if (segment === "**") {
    if (pi === pattern.length - 1) {
      return true;
    }
    for (let start = si; start <= path.length; start++) {
      if (matchSegments(pattern, path, pi + 1, start)) {
        return true;
      }
    }
    return false;
  }

  if (si >= path.length) {
    return false;
  }

  if (!matchSegment(segment, path[si]!)) {
    return false;
  }

  return matchSegments(pattern, path, pi + 1, si + 1);
}

// nm-style: keep-local — 段内通配回溯的自递归函数：`*` 分支内联后失去自身引用。
function matchSegment(pattern: string, segment: string): boolean {
  let pi = 0;
  let si = 0;
  while (pi < pattern.length) {
    const ch = pattern[pi]!;
    if (ch === "*") {
      if (pi + 1 < pattern.length && pattern[pi + 1] === "*") {
        return false;
      }
      if (pi === pattern.length - 1) {
        return true;
      }
      for (let j = si; j <= segment.length; j++) {
        if (matchSegment(pattern.slice(pi + 1), segment.slice(j))) {
          return true;
        }
      }
      return false;
    }
    if (ch === "?") {
      if (si >= segment.length) {
        return false;
      }
      pi++;
      si++;
      continue;
    }
    if (si >= segment.length || segment[si] !== ch) {
      return false;
    }
    pi++;
    si++;
  }
  return si === segment.length;
}
