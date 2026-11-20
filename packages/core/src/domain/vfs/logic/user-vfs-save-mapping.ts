/**
 * 用户 VFS 保存：锚点 diff → `edit`，失败 fallback `write`；同步生成 action XML。
 *
 * @module domain/vfs/logic/user-vfs-save-mapping
 */

import { diffArrays } from "diff";
import { Text } from "@/common/text.js";
import { UserVfsActionXml } from "./user-vfs-action-xml.js";
import type { ToolUseBlock } from "@/domain/chat/model/content-block.js";

/** 保存映射可选参数。 */
export interface UserVfsSaveMappingOptions {
  readonly replaceAll?: boolean;
}

/** edit hunk 描述（与 tool_use.input 及 action XML 同源）。 */
interface UserVfsEditHunk {
  readonly index: number;
  readonly oldString: string;
  readonly newString: string;
}

type UserVfsSaveMappingResult =
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

export const UserVfsSaveMapping = {
  /**
   * 将用户保存映射为 `edit` 多 hunk 或 `write` fallback / no-op。
   *
   * @param baseline - 保存前磁盘内容；`null` 表示新文件。
   * @param saved - 用户保存后的全文（与 `fileContentAtSave` 一致）。
   */
  mapToToolUses(baseline: string | null, _saved: string, path: string, fileContentAtSave: string, options?: UserVfsSaveMappingOptions): UserVfsSaveMappingResult {
    const content = fileContentAtSave;
    if (baseline != null && baseline === content) {
      return { kind: "noop" };
    }
    if (baseline == null) {
      return { kind: "write", path, content, reason: "new-file" };
    }

    const baselineLines = Text.splitLines(baseline);
    const savedLines = Text.splitLines(content);
    // 行级 diff：基于 Myers 算法（`diff` 包的 `diffArrays`）把相邻 added/removed
    // （中间没有公共行）归并成一个变更块，最终转换成闭区间表示。
    // 纯插入侧 oldStart > oldEnd、纯删除侧 newStart > newEnd，由下方对称扩展处理。
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
      regions.push({ oldStart: blockOldStart, oldEnd: oldEndExclusive - 1, newStart: blockNewStart, newEnd: newEndExclusive - 1 });
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
    if (regions.length === 0) {
      return { kind: "noop" };
    }

    const hunks: UserVfsEditHunk[] = [];
    const toolUses: ToolUseBlock[] = [];

    for (const region of regions) {
      // 基于 Myers 输出做对称线性扩展：每轮把上下文向首尾各扩 radius 行，
      // 找到第一个在 baseline 中唯一出现的锚点就返回。
      let anchor: { oldString: string; newString: string } | null = null;
      const maxRadius = Math.max(baselineLines.length, savedLines.length);
      for (let radius = 0; radius <= maxRadius; radius++) {
        const oldStart = Math.max(0, region.oldStart - radius);
        const oldEnd = Math.min(baselineLines.length - 1, region.oldEnd + radius);
        const newStart = Math.max(0, region.newStart - radius);
        const newEnd = Math.min(savedLines.length - 1, region.newEnd + radius);
        if (oldStart > oldEnd || newStart > newEnd) continue;
        const oldString = Text.joinLines(baselineLines.slice(oldStart, oldEnd + 1));
        if (oldString === "") continue;
        let occurrences = 0;
        for (let pos = 0; ; ) {
          const hit = baseline.indexOf(oldString, pos);
          if (hit < 0) break;
          occurrences += 1;
          pos = hit + oldString.length;
        }
        if (occurrences !== 1) continue;
        anchor = { oldString, newString: Text.joinLines(savedLines.slice(newStart, newEnd + 1)) };
        break;
      }
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
      toolUses.push({
        type: "tool_use",
        id: "",
        name: "edit",
        input: {
          path,
          oldString: anchor.oldString,
          newString: anchor.newString,
          ...(options?.replaceAll === true ? { options: { replaceAll: true } } : {}),
        },
      });
    }

    return {
      kind: "edit",
      path,
      toolUses,
      editHunks: hunks,
    };
  },

  /** 生成 write 的 `<action name="write">`（正文在 JSON `content`）。 */
  buildWriteActionXml(path: string, _reason: "new-file" | "anchor-not-unique" = "anchor-not-unique", content = ""): string {
    return UserVfsActionXml.build("write", { path, content });
  },

  /** 生成 edit：每个 hunk 一条 `<action name="edit">`（oldString/newString）。 */
  buildEditActionXml(path: string, editHunks: readonly UserVfsEditHunk[]): string {
    const actions = editHunks.map((hunk) => UserVfsActionXml.build("edit", { path, oldString: hunk.oldString, newString: hunk.newString }));
    return actions.join("\n");
  },

  /** 生成 delete / mkdir / rename / move 的 `<action name="…">`。 */
  buildSimpleActionXml(kind: "delete" | "mkdir" | "rename" | "move", attrs: Record<string, string>): string {
    if (kind === "delete") {
      const params: Record<string, unknown> = { path: attrs.path ?? "" };
      if (attrs.recursive === "true") {
        params.recursive = true;
      }
      return UserVfsActionXml.build("delete", params);
    }
    if (kind === "mkdir") {
      return UserVfsActionXml.build("mkdir", { path: attrs.path ?? "" });
    }
    // rename（同目录）与 move（跨目录）JSON 字段同为 from/to；VFS 底层仍 mv。
    return UserVfsActionXml.build(kind, {
      from: attrs.from ?? "",
      to: attrs.to ?? "",
    });
  },
} as const;
