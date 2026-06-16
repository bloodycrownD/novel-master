/**
 * 用户 VFS 保存：锚点 diff → `edit`，失败 fallback `write`；同步生成 action XML。
 *
 * @module domain/vfs/logic/user-vfs-save-mapping
 */

import type { ToolUseBlock } from "@/domain/chat/model/content-block.js";

/** 保存映射可选参数。 */
export interface UserVfsSaveMappingOptions {
  readonly replaceAll?: boolean;
}

/** edit hunk 描述（与 tool_use.input 及 action XML 同源）。 */
export interface UserVfsEditHunk {
  readonly index: number;
  readonly oldString: string;
  readonly newString: string;
}

export type UserVfsSaveMappingResult =
  | { readonly kind: "noop" }
  | {
      readonly kind: "write";
      readonly path: string;
      readonly content: string;
      readonly reason?: "new-file" | "anchor-not-unique";
    }
  | {
      readonly kind: "edit";
      readonly path: string;
      readonly toolUses: readonly ToolUseBlock[];
      readonly editHunks: readonly UserVfsEditHunk[];
    };

type LineChangeRegion = {
  readonly oldStart: number;
  readonly oldEnd: number;
  readonly newStart: number;
  readonly newEnd: number;
};

function splitLines(text: string): string[] {
  if (text === "") {
    return [];
  }
  return text.split("\n");
}

function joinLines(lines: readonly string[]): string {
  return lines.join("\n");
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") {
    return 0;
  }
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx < 0) {
      break;
    }
    count += 1;
    pos = idx + needle.length;
  }
  return count;
}

/** 行级 diff：返回若干不相交的变更区间。 */
function computeLineChangeRegions(
  baselineLines: readonly string[],
  savedLines: readonly string[],
): LineChangeRegion[] {
  const regions: LineChangeRegion[] = [];
  diffRecursive(
    baselineLines,
    0,
    baselineLines.length,
    savedLines,
    0,
    savedLines.length,
    regions,
  );
  return regions;
}

function diffRecursive(
  oldLines: readonly string[],
  oStart: number,
  oEnd: number,
  newLines: readonly string[],
  nStart: number,
  nEnd: number,
  regions: LineChangeRegion[],
): void {
  let os = oStart;
  let ns = nStart;
  let oe = oEnd;
  let ne = nEnd;

  while (os < oe && ns < ne && oldLines[os] === newLines[ns]) {
    os++;
    ns++;
  }
  while (os < oe && ns < ne && oldLines[oe - 1] === newLines[ne - 1]) {
    oe--;
    ne--;
  }
  if (os >= oe && ns >= ne) {
    return;
  }

  for (let oi = os; oi < oe; oi++) {
    for (let nj = ns; nj < ne; nj++) {
      if (oldLines[oi] === newLines[nj]) {
        if (oi > os || nj > ns) {
          regions.push({
            oldStart: os,
            oldEnd: oi - 1,
            newStart: ns,
            newEnd: nj - 1,
          });
        }
        diffRecursive(oldLines, oi, oe, newLines, nj, ne, regions);
        return;
      }
    }
  }

  regions.push({
    oldStart: os,
    oldEnd: oe - 1,
    newStart: ns,
    newEnd: ne - 1,
  });
}

function expandAnchorHunk(
  baseline: string,
  baselineLines: readonly string[],
  savedLines: readonly string[],
  region: LineChangeRegion,
): { oldString: string; newString: string } | null {
  const maxRadius = Math.max(baselineLines.length, savedLines.length);
  for (let radius = 0; radius <= maxRadius; radius++) {
    const candidates: Array<{ before: number; after: number }> = [];
    for (let before = 0; before <= radius; before++) {
      candidates.push({ before, after: radius - before });
    }
    for (const { before, after } of candidates) {
      const oldStart = Math.max(0, region.oldStart - before);
      const oldEnd = Math.min(baselineLines.length - 1, region.oldEnd + after);
      const newStart = Math.max(0, region.newStart - before);
      const newEnd = Math.min(savedLines.length - 1, region.newEnd + after);
      if (oldStart > oldEnd || newStart > newEnd) {
        continue;
      }
      const oldString = joinLines(baselineLines.slice(oldStart, oldEnd + 1));
      if (oldString === "" || countOccurrences(baseline, oldString) !== 1) {
        continue;
      }
      const newString = joinLines(savedLines.slice(newStart, newEnd + 1));
      return { oldString, newString };
    }
  }
  return null;
}

function buildEditToolUse(
  path: string,
  oldString: string,
  newString: string,
  options?: UserVfsSaveMappingOptions,
): ToolUseBlock {
  return {
    type: "tool_use",
    id: "",
    name: "edit",
    input: {
      path,
      oldString,
      newString,
      ...(options?.replaceAll === true
        ? { options: { replaceAll: true } }
        : {}),
    },
  };
}

/**
 * 将用户保存映射为 `edit` 多 hunk 或 `write` fallback / no-op。
 *
 * @param baseline - 保存前磁盘内容；`null` 表示新文件。
 * @param saved - 用户保存后的全文（与 `fileContentAtSave` 一致）。
 */
export function mapUserSaveToToolUses(
  baseline: string | null,
  _saved: string,
  path: string,
  fileContentAtSave: string,
  options?: UserVfsSaveMappingOptions,
): UserVfsSaveMappingResult {
  const content = fileContentAtSave;
  if (baseline != null && baseline === content) {
    return { kind: "noop" };
  }
  if (baseline == null) {
    return { kind: "write", path, content, reason: "new-file" };
  }

  const baselineLines = splitLines(baseline);
  const savedLines = splitLines(content);
  const regions = computeLineChangeRegions(baselineLines, savedLines);
  if (regions.length === 0) {
    return { kind: "noop" };
  }

  const hunks: UserVfsEditHunk[] = [];
  const toolUses: ToolUseBlock[] = [];

  for (const region of regions) {
    const anchor = expandAnchorHunk(baseline, baselineLines, savedLines, region);
    if (anchor == null || anchor.oldString === baseline) {
      return {
        kind: "write",
        path,
        content,
        reason: "anchor-not-unique",
      };
    }
    hunks.push({
      index: hunks.length + 1,
      oldString: anchor.oldString,
      newString: anchor.newString,
    });
    toolUses.push(
      buildEditToolUse(path, anchor.oldString, anchor.newString, options),
    );
  }

  return {
    kind: "edit",
    path,
    toolUses,
    editHunks: hunks,
  };
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

/** 生成 save + edit 的 `<user-vfs-action>` XML。 */
export function buildUserVfsSaveEditActionXml(
  path: string,
  editHunks: readonly UserVfsEditHunk[],
): string {
  const hunkXml = editHunks
    .map(
      (hunk) =>
        `  <edit-hunk index="${hunk.index}">\n` +
        `    <old>${escapeXmlText(hunk.oldString)}</old>\n` +
        `    <new>${escapeXmlText(hunk.newString)}</new>\n` +
        `  </edit-hunk>`,
    )
    .join("\n");
  return (
    `<user-vfs-action kind="save" path="${escapeXmlAttr(path)}" method="edit" hunks="${editHunks.length}">\n` +
    `${hunkXml}\n` +
    `</user-vfs-action>`
  );
}

/** 生成 save + write fallback 的 `<user-vfs-action>` XML。 */
export function buildUserVfsSaveWriteActionXml(
  path: string,
  reason: "new-file" | "anchor-not-unique" = "anchor-not-unique",
): string {
  return `<user-vfs-action kind="save" path="${escapeXmlAttr(path)}" method="write" reason="${reason}" />`;
}

/** 生成 delete / mkdir / rename 等非 save 类 action XML。 */
export function buildUserVfsSimpleActionXml(
  kind: "delete" | "mkdir" | "rename",
  attrs: Record<string, string>,
): string {
  const parts = Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeXmlAttr(value)}"`)
    .join(" ");
  return `<user-vfs-action kind="${kind}" ${parts} />`;
}
