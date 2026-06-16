/**
 * 从 UI VFS 操作构建 {@link UserVfsTurnOp} 入参。
 *
 * @module service/vfs/build-user-vfs-turn-op
 */

import {
  buildUserVfsSaveEditActionXml,
  buildUserVfsSaveWriteActionXml,
  buildUserVfsSimpleActionXml,
  mapUserSaveToToolUses,
  type UserVfsSaveMappingOptions,
} from "@/domain/vfs/logic/user-vfs-save-mapping.js";
import type {
  UserVfsTurnOp,
  UserVfsTurnToolSpec,
} from "@/service/chat/user-vfs-turn.port.js";

/** 保存操作可选版本校验（与 session-fs.versionCheck 对齐）。 */
export interface UserVfsSaveVersionOptions {
  readonly expectedVersion?: number;
  readonly versionCheck?: boolean;
}

let toolIdSeq = 0;

function allocToolIds(count: number, prefix: string): string[] {
  const stamp = Date.now();
  return Array.from(
    { length: count },
    (_, index) => `tu_${prefix}_${stamp}_${toolIdSeq++}_${index}`,
  );
}

function toOp(actionXml: string, tools: UserVfsTurnToolSpec[]): UserVfsTurnOp {
  return { actionXml, tools };
}

/** 构建删除操作 op。 */
export function buildUserVfsDeleteOp(
  path: string,
  recursive = true,
): UserVfsTurnOp {
  const actionXml = buildUserVfsSimpleActionXml("delete", {
    path,
    ...(recursive ? { recursive: "true" } : {}),
  });
  const command = recursive ? `rm -r ${path}` : `rm ${path}`;
  const [id] = allocToolIds(1, "delete");
  return toOp(actionXml, [{ id, name: "fs", input: { command } }]);
}

/** 构建新建目录操作 op。 */
export function buildUserVfsMkdirOp(path: string): UserVfsTurnOp {
  const actionXml = buildUserVfsSimpleActionXml("mkdir", { path });
  const [id] = allocToolIds(1, "mkdir");
  return toOp(actionXml, [{ id, name: "fs", input: { command: `mkdir ${path}` } }]);
}

/** 构建重命名/移动操作 op。 */
export function buildUserVfsRenameOp(from: string, to: string): UserVfsTurnOp {
  const actionXml = buildUserVfsSimpleActionXml("rename", { from, to });
  const [id] = allocToolIds(1, "rename");
  return toOp(actionXml, [
    { id, name: "fs", input: { command: `mv ${from} ${to}` } },
  ]);
}

/** 构建新建文件（write）操作 op。 */
export function buildUserVfsCreateFileOp(
  path: string,
  content = "",
): UserVfsTurnOp {
  const actionXml = buildUserVfsSaveWriteActionXml(path, "new-file");
  const [id] = allocToolIds(1, "create");
  return toOp(actionXml, [{ id, name: "write", input: { path, content } }]);
}

/**
 * 构建保存编辑操作 op；内容无变化时返回 `null`（no-op）。
 */
export function buildUserVfsSaveOp(
  baseline: string | null,
  saved: string,
  path: string,
  fileContentAtSave: string,
  versionOptions?: UserVfsSaveVersionOptions,
  mappingOptions?: UserVfsSaveMappingOptions,
): UserVfsTurnOp | null {
  const mapped = mapUserSaveToToolUses(
    baseline,
    saved,
    path,
    fileContentAtSave,
    mappingOptions,
  );

  if (mapped.kind === "noop") {
    return null;
  }

  if (mapped.kind === "write") {
    const actionXml = buildUserVfsSaveWriteActionXml(
      mapped.path,
      mapped.reason ?? "anchor-not-unique",
    );
    const [id] = allocToolIds(1, "write");
    const writeInput: Record<string, unknown> = {
      path: mapped.path,
      content: mapped.content,
    };
    if (
      versionOptions?.versionCheck === true ||
      versionOptions?.expectedVersion != null
    ) {
      writeInput.options = {
        versionCheck: versionOptions.versionCheck ?? true,
        ...(versionOptions.expectedVersion != null
          ? { expectedVersion: versionOptions.expectedVersion }
          : {}),
      };
    }
    return toOp(actionXml, [{ id, name: "write", input: writeInput }]);
  }

  const actionXml = buildUserVfsSaveEditActionXml(mapped.path, mapped.editHunks);
  const ids = allocToolIds(mapped.toolUses.length, "edit");
  const tools = mapped.toolUses.map((toolUse, index) => ({
    id: ids[index]!,
    name: toolUse.name,
    input: toolUse.input,
  }));
  return toOp(actionXml, tools);
}
