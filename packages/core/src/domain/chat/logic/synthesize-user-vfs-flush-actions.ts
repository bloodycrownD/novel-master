/**
 * 将 flush 终态 diff 合成为多行 `<user-vfs-action>` XML。
 *
 * @module domain/chat/logic/synthesize-user-vfs-flush-actions
 */

import {
  buildUserVfsSaveEditActionXml,
  buildUserVfsSaveWriteActionXml,
  buildUserVfsSimpleActionXml,
  mapUserSaveToToolUses,
} from "@/domain/vfs/logic/user-vfs-save-mapping.js";
import type { WorkspaceFlushDiff } from "./diff-workspace-for-user-vfs-flush.js";

/**
 * 按 mkdir → rename → 新增/变更 save → 删文件 → 删目录 顺序合成 action XML 行。
 *
 * @returns 多行 XML；无变更时返回空字符串。
 */
export function synthesizeUserVfsFlushActions(diff: WorkspaceFlushDiff): string {
  const lines: string[] = [];

  for (const dir of diff.addedDirs) {
    lines.push(buildUserVfsSimpleActionXml("mkdir", { path: dir }));
  }

  for (const { from, to } of diff.renames) {
    lines.push(buildUserVfsSimpleActionXml("rename", { from, to }));
  }

  for (const { path } of diff.addedFiles) {
    lines.push(buildUserVfsSaveWriteActionXml(path, "new-file"));
  }

  for (const { path, baselineContent, currentContent } of diff.changedFiles) {
    const mapped = mapUserSaveToToolUses(
      baselineContent,
      currentContent,
      path,
      currentContent,
    );
    if (mapped.kind === "noop") {
      continue;
    }
    if (mapped.kind === "write") {
      lines.push(
        buildUserVfsSaveWriteActionXml(
          mapped.path,
          mapped.reason ?? "anchor-not-unique",
        ),
      );
      continue;
    }
    lines.push(buildUserVfsSaveEditActionXml(mapped.path, mapped.editHunks));
  }

  for (const path of diff.deletedFiles) {
    lines.push(
      buildUserVfsSimpleActionXml("delete", { path, recursive: "true" }),
    );
  }

  for (const path of diff.deletedDirs) {
    lines.push(
      buildUserVfsSimpleActionXml("delete", { path, recursive: "true" }),
    );
  }

  return lines.join("\n");
}
