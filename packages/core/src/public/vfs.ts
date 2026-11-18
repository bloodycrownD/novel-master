export type { VfsEntry, VfsEntryKind } from "../domain/vfs/model/vfs-entry.js";
export type { VfsListEntry } from "../domain/vfs/model/vfs-list-entry.js";
export { VfsServiceFactory } from "../service/vfs/vfs-service-factory.js";
export type { CreateCharacterCardImportServiceOptions } from "../service/vfs/vfs-service-factory.js";
export type { PhysicalVfsService } from "../service/vfs/physical-vfs.port.js";
// 归属例外（check-public-ownership）：角色卡经 VFS 导入，上限常量留本门面。
export { CHARACTER_CARD_MAX_INPUT_BYTES } from "../domain/character-card/logic/character-card-limits.js";
export type {
  CharacterCardImportService,
  CharacterCardImportOptions,
} from "../domain/vfs/ports/character-card-import.port.js";
export {
  buildUserVfsCreateFileOp,
  buildUserVfsDeleteOp,
  buildUserVfsMkdirOp,
  buildUserVfsRenameOp,
  buildUserVfsSaveOp,
} from "../service/vfs/build-user-vfs-turn-op.js";
export { buildVfsZip } from "../domain/vfs/logic/vfs-zip-build.js";
export { parseVfsZip } from "../domain/vfs/logic/vfs-zip-parse.js";
export { zipBaseNameFromPath } from "../domain/vfs/logic/vfs-zip-path.js";
export { resolveZipDirectoryPath } from "../domain/vfs/logic/vfs-zip-path.js";
export { assertZipArchive } from "../domain/vfs/logic/vfs-zip-archive.js";
export type {
  VfsZipIoService,
  VfsZipImportOptions,
  ZipPathOptions,
} from "../domain/vfs/ports/vfs-zip-io.port.js";
export type {
  VfsBatchIoService,
  BatchIngestRawEntry,
  BatchIngestPlanEntry,
  BatchIngestPlan,
  BatchConflict,
  BatchApplyReport,
  BatchApplyOptions,
  BatchExportPlan,
  BatchExportSkip,
  BatchIngestWriter,
} from "../domain/vfs/ports/vfs-batch-io.port.js";
export {
  joinTargetLogicalPath,
  normalizeBatchRelativePath,
  relativePathUnderAnchor,
} from "../domain/vfs/logic/vfs-batch-path.js";
export type {
  VfsService,
  VfsReadResult,
  VfsGrepMatch,
  VfsContentSize,
} from "../domain/vfs/ports/vfs-service.port.js";
// revision 仓库出口：checkpoint / 回滚 / VFS 服务层等装配同 conn 单实例时
// 构造（read 计数通道与 hydrate 链已随 E1 清理版退役，v1.5.40 同批）。
export { SqliteVfsRevisionRepository } from "../domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
export type { VfsRevisionRepository } from "../domain/vfs/repositories/vfs-revision.port.js";
export type { VfsScope } from "../domain/vfs/logic/vfs-path-mapper.js";
export { isSessionVfsScope } from "../domain/vfs/logic/vfs-path-mapper.js";
// 路径族单源：宽松父目录（root/非法 → null）留在 VFS 域；basename / 去尾斜杠 /
// 改挂目录等纯字符串原语已收敛到 `@novel-master/core/common` 的 `Path`。
export { parentDirOrNull } from "../domain/vfs/logic/parent-dir.js";
export {
  resolveLogicalPath,
  validateLogicalPath,
  scopePhysicalPrefix,
} from "../domain/vfs/logic/vfs-path-mapper.js";
export {
  createVfsFile,
  createVfsDirectory,
  deleteVfsEntry,
} from "../domain/vfs/logic/vfs-entry-ops.js";
export {
  moveVfsPath,
  mkdirIgnoreExists,
  mkdirIgnoreExistingDirectory,
} from "../domain/vfs/logic/vfs-move.js";
export { copyVfsPath } from "../domain/vfs/logic/vfs-copy.js";
export type { CopyVfsPathOptions } from "../domain/vfs/logic/vfs-copy.js";
export { replaceVfsSubtree } from "../domain/vfs/logic/vfs-tree-copy.js";
export {
  mapUserSaveToToolUses,
  buildUserVfsActionXml,
  buildUserVfsSaveEditActionXml,
  buildUserVfsSaveWriteActionXml,
  buildUserVfsSimpleActionXml,
} from "../domain/vfs/logic/user-vfs-save-mapping.js";
export { readUserVfsSaveBaseline } from "../domain/vfs/logic/read-user-vfs-save-baseline.js";
export { vfsUserMessage } from "../domain/vfs/logic/format-vfs-error-for-user.js";
export { validateVfsEntryName } from "../domain/vfs/logic/validate-entry-name.js";
export type { UserVfsSaveMappingOptions } from "../domain/vfs/logic/user-vfs-save-mapping.js";
export { actionXmlToToolUses } from "../domain/vfs/logic/action-xml-to-tool-uses.js";
export type { DerivedToolUseInput } from "../domain/vfs/logic/action-xml-to-tool-uses.js";
