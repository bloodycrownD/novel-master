/**
 * 将 flush 终态 diff 合成为多行 `<action name="…">` XML（及 UI 用 action:path 摘要）。
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

/** flush / Composer 共用的单条 user_ops 摘要（展示 `action:path`）。 */
export type UserOpsActionSummary = {
  readonly action: "write" | "edit" | "mkdir" | "delete" | "rename";
  /** 展示用 path；rename 为 `from→to`。 */
  readonly path: string;
};

/** 带同源 XML 的合成条目（flush 落附件用）。 */
export type SynthesizedUserVfsAction = UserOpsActionSummary & {
  readonly xml: string;
};

/** `name` / chip 文案：`write:/xxx.md`。 */
export function formatUserOpsActionLabel(
  summary: UserOpsActionSummary,
): string {
  return `${summary.action}:${summary.path}`;
}

/**
 * 按 mkdir → rename → 新增/变更 save → 删文件 → 删目录 顺序合成条目。
 *
 * @remarks 相对 checkpoint 净 diff；同 path 创建+再改只会落一条 write/edit。
 */
export function synthesizeUserVfsFlushActionEntries(
  diff: WorkspaceFlushDiff,
): readonly SynthesizedUserVfsAction[] {
  const entries: SynthesizedUserVfsAction[] = [];

  for (const dir of diff.addedDirs) {
    entries.push({
      action: "mkdir",
      path: dir,
      xml: buildUserVfsSimpleActionXml("mkdir", { path: dir }),
    });
  }

  for (const { from, to } of diff.renames) {
    entries.push({
      action: "rename",
      path: `${from}→${to}`,
      xml: buildUserVfsSimpleActionXml("rename", { from, to }),
    });
  }

  for (const { path, content } of diff.addedFiles) {
    entries.push({
      action: "write",
      path,
      xml: buildUserVfsSaveWriteActionXml(path, "new-file", content),
    });
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
      entries.push({
        action: "write",
        path: mapped.path,
        xml: buildUserVfsSaveWriteActionXml(
          mapped.path,
          mapped.reason ?? "anchor-not-unique",
          mapped.content,
        ),
      });
      continue;
    }
    entries.push({
      action: "edit",
      path: mapped.path,
      xml: buildUserVfsSaveEditActionXml(mapped.path, mapped.editHunks),
    });
  }

  for (const path of diff.deletedFiles) {
    entries.push({
      action: "delete",
      path,
      xml: buildUserVfsSimpleActionXml("delete", {
        path,
        recursive: "true",
      }),
    });
  }

  for (const path of diff.deletedDirs) {
    entries.push({
      action: "delete",
      path,
      xml: buildUserVfsSimpleActionXml("delete", {
        path,
        recursive: "true",
      }),
    });
  }

  return entries;
}

/**
 * 按 mkdir → rename → 新增/变更 save → 删文件 → 删目录 顺序合成 action XML 行。
 *
 * @returns 多行 XML；无变更时返回空字符串。
 */
export function synthesizeUserVfsFlushActions(diff: WorkspaceFlushDiff): string {
  return synthesizeUserVfsFlushActionEntries(diff)
    .map((e) => e.xml)
    .join("\n");
}

/**
 * 从 flush 净 diff 收集 UI 摘要（稳定顺序，与合成 XML 一致）。
 */
export function collectUserOpsActionSummaries(
  diff: WorkspaceFlushDiff,
): readonly UserOpsActionSummary[] {
  return synthesizeUserVfsFlushActionEntries(diff).map(
    ({ action, path }) => ({ action, path }),
  );
}
