/**
 * 从 UI VFS 操作构建 {@link UserVfsTurnOp} 入参。
 *
 * @module service/vfs/build-user-vfs-turn-op
 */

import { attachmentPath } from "@/domain/chat/logic/message/attachment-path.js";
import { UserVfsSaveMapping, type UserVfsSaveMappingOptions } from "@/domain/vfs/logic/user-vfs-save-mapping.js";
import type { UserVfsTurnOp, UserVfsTurnToolSpec } from "@/service/chat/user-vfs-turn.port.js";

/** 工具 ID 自增序号（模块内 holder，对象管理）。 */
const toolIdCounter = { seq: 0 };

/** UI VFS turn op 构建器集合（delete / mkdir / rename / create / save）。 */
export const UserVfsTurnOps = {
  allocToolIds(count: number, prefix: string): string[] {
    const stamp = Date.now();
    return Array.from({ length: count }, (_, index) => `tu_${prefix}_${stamp}_${toolIdCounter.seq++}_${index}`);
  },

  toOp(actionXml: string, tools: UserVfsTurnToolSpec[]): UserVfsTurnOp {
    return { actionXml, tools };
  },

  /** 构建删除操作 op。 */
  buildDelete(path: string, recursive = true): UserVfsTurnOp {
    const actionXml = UserVfsSaveMapping.buildSimpleActionXml("delete", {
      path,
      ...(recursive ? { recursive: "true" } : {}),
    });
    const [id] = UserVfsTurnOps.allocToolIds(1, "delete");
    return UserVfsTurnOps.toOp(actionXml, [{ id, name: "fs", input: { action: "rm", path, recursive } }]);
  },

  /** 构建新建目录操作 op。 */
  buildMkdir(path: string): UserVfsTurnOp {
    const actionXml = UserVfsSaveMapping.buildSimpleActionXml("mkdir", { path });
    const [id] = UserVfsTurnOps.allocToolIds(1, "mkdir");
    return UserVfsTurnOps.toOp(actionXml, [{ id, name: "fs", input: { action: "mkdir", path } }]);
  },

  /**
   * 构建重命名/移动操作 op。
   * 同目录 → `<action name="rename">`；跨目录 → `name="move"`；VFS 仍 `mv`。
   */
  buildRename(from: string, to: string): UserVfsTurnOp {
    const kind = attachmentPath.actionBetween(from, to);
    const actionXml = UserVfsSaveMapping.buildSimpleActionXml(kind, { from, to });
    const [id] = UserVfsTurnOps.allocToolIds(1, kind);
    return UserVfsTurnOps.toOp(actionXml, [{ id, name: "fs", input: { action: "mv", from, to } }]);
  },

  /** 构建新建文件（write）操作 op。 */
  buildCreateFile(path: string, content = ""): UserVfsTurnOp {
    const actionXml = UserVfsSaveMapping.buildWriteActionXml(path, "new-file", content);
    const [id] = UserVfsTurnOps.allocToolIds(1, "create");
    return UserVfsTurnOps.toOp(actionXml, [{ id, name: "write", input: { path, content } }]);
  },

  /**
   * 构建保存编辑操作 op；内容无变化时返回 `null`（no-op）。
   */
  buildSave(baseline: string | null, saved: string, path: string, fileContentAtSave: string, mappingOptions?: UserVfsSaveMappingOptions): UserVfsTurnOp | null {
    const mapped = UserVfsSaveMapping.mapToToolUses(baseline, saved, path, fileContentAtSave, mappingOptions);

    if (mapped.kind === "noop") {
      return null;
    }

    if (mapped.kind === "write") {
      const actionXml = UserVfsSaveMapping.buildWriteActionXml(mapped.path, mapped.reason ?? "anchor-not-unique", mapped.content);
      const [id] = UserVfsTurnOps.allocToolIds(1, "write");
      const writeInput: Record<string, unknown> = {
        path: mapped.path,
        content: mapped.content,
      };
      return UserVfsTurnOps.toOp(actionXml, [{ id, name: "write", input: writeInput }]);
    }

    const actionXml = UserVfsSaveMapping.buildEditActionXml(mapped.path, mapped.editHunks);
    const ids = UserVfsTurnOps.allocToolIds(mapped.toolUses.length, "edit");
    const tools = mapped.toolUses.map((toolUse, index) => ({
      id: ids[index]!,
      name: toolUse.name,
      input: toolUse.input,
    }));
    return UserVfsTurnOps.toOp(actionXml, tools);
  },
} as const;
