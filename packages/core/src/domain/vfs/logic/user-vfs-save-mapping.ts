/**
 * 用户 VFS 保存：锚点 diff → `edit`，失败 fallback `write`；同步生成 action XML。
 *
 * @module domain/vfs/logic/user-vfs-save-mapping
 */

import { diffArrays } from "diff";
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

/**
 * 行级 diff：基于 Myers 算法（`diff` 包的 `diffArrays`）。
 *
 * Myers 会把变更拆成若干 added/removed 片段，这里再把相邻的 added/removed
 * （中间没有公共行）归并成一个变更块，最终转换成与原来一致的闭区间表示。
 * 纯插入侧 oldStart > oldEnd、纯删除侧 newStart > newEnd，由 expandAnchorHunk 处理。
 */
function computeLineChangeRegions(
  baselineLines: readonly string[],
  savedLines: readonly string[]
): LineChangeRegion[] {
  const regions: LineChangeRegion[] = [];
  const parts = diffArrays([...baselineLines], [...savedLines]);

  let oldIdx = 0; // 已消费的 baseline 行号（开区间端点）
  let newIdx = 0; // 已消费的 saved 行号（开区间端点）
  let blockOldStart = 0; // 当前变更块在 baseline 的起点
  let blockNewStart = 0; // 当前变更块在 saved 的起点
  let inBlock = false;

  // 把当前变更块落成一个 region；oldEnd/newEnd 用闭区间（开区间端点 - 1）。
  const flush = (oldEndExclusive: number, newEndExclusive: number): void => {
    if (!inBlock) return;
    regions.push({
      oldStart: blockOldStart,
      oldEnd: oldEndExclusive - 1,
      newStart: blockNewStart,
      newEnd: newEndExclusive - 1,
    });
    inBlock = false;
  };

  for (const part of parts) {
    if (part.added) {
      // 进入变更块时记下起点（此时两侧都还没推进，天然对齐到块首）。
      if (!inBlock) {
        inBlock = true;
        blockOldStart = oldIdx;
        blockNewStart = newIdx;
      }
      newIdx += part.count;
    } else if (part.removed) {
      if (!inBlock) {
        inBlock = true;
        blockOldStart = oldIdx;
        blockNewStart = newIdx;
      }
      oldIdx += part.count;
    } else {
      // 公共行会切断变更块：先落盘当前块，再同步推进两侧指针。
      flush(oldIdx, newIdx);
      oldIdx += part.count;
      newIdx += part.count;
    }
  }
  flush(oldIdx, newIdx);

  return regions;
}

/**
 * 基于 Myers 输出做对称线性扩展：每轮把上下文向首尾各扩 radius 行，
 * 找到第一个在 baseline 中唯一出现的锚点就返回。
 */
function expandAnchorHunk(
  baseline: string,
  baselineLines: readonly string[],
  savedLines: readonly string[],
  region: LineChangeRegion
): { oldString: string; newString: string } | null {
  const maxRadius = Math.max(baselineLines.length, savedLines.length);
  for (let radius = 0; radius <= maxRadius; radius++) {
    const oldStart = Math.max(0, region.oldStart - radius);
    const oldEnd = Math.min(baselineLines.length - 1, region.oldEnd + radius);
    const newStart = Math.max(0, region.newStart - radius);
    const newEnd = Math.min(savedLines.length - 1, region.newEnd + radius);
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
  return null;
}

function buildEditToolUse(
  path: string,
  oldString: string,
  newString: string,
  options?: UserVfsSaveMappingOptions
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
  options?: UserVfsSaveMappingOptions
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
    const anchor = expandAnchorHunk(
      baseline,
      baselineLines,
      savedLines,
      region
    );
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
      buildEditToolUse(path, anchor.oldString, anchor.newString, options)
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

/**
 * 通用 action XML：`<action name="…">{json}</action>`。
 * JSON 为对应 tool / 操作入参（写盘后供 LLM 与 round-trip）。
 */
export function buildUserVfsActionXml(
  name: string,
  params: Record<string, unknown>
): string {
  const body = escapeXmlText(JSON.stringify(params, null, 2));
  return `<action name="${escapeXmlAttr(name)}">\n${body}\n</action>`;
}

/** 生成 write 的 `<action name="write">`（正文在 JSON `content`）。 */
export function buildUserVfsSaveWriteActionXml(
  path: string,
  _reason: "new-file" | "anchor-not-unique" = "anchor-not-unique",
  content = ""
): string {
  return buildUserVfsActionXml("write", { path, content });
}

/** 生成 edit：每个 hunk 一条 `<action name="edit">`（oldString/newString）。 */
export function buildUserVfsSaveEditActionXml(
  path: string,
  editHunks: readonly UserVfsEditHunk[]
): string {
  return editHunks
    .map((hunk) =>
      buildUserVfsActionXml("edit", {
        path,
        oldString: hunk.oldString,
        newString: hunk.newString,
      })
    )
    .join("\n");
}

/** 生成 delete / mkdir / rename / move 的 `<action name="…">`。 */
export function buildUserVfsSimpleActionXml(
  kind: "delete" | "mkdir" | "rename" | "move",
  attrs: Record<string, string>
): string {
  if (kind === "delete") {
    const params: Record<string, unknown> = { path: attrs.path ?? "" };
    if (attrs.recursive === "true") {
      params.recursive = true;
    }
    return buildUserVfsActionXml("delete", params);
  }
  if (kind === "mkdir") {
    return buildUserVfsActionXml("mkdir", { path: attrs.path ?? "" });
  }
  // rename（同目录）与 move（跨目录）JSON 字段同为 from/to；VFS 底层仍 mv。
  return buildUserVfsActionXml(kind, {
    from: attrs.from ?? "",
    to: attrs.to ?? "",
  });
}
