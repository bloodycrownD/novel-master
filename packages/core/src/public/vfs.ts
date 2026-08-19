export { VfsError, isVfsError } from "../errors/vfs-errors.js";
export type { VfsErrorCode } from "../errors/vfs-errors.js";
export type { VfsEntry, VfsEntryKind } from "../domain/vfs/model/vfs-entry.js";
export type { VfsListEntry } from "../domain/vfs/model/vfs-list-entry.js";
export { createVfsService } from "../service/vfs/create-vfs-service.js";
export { createScopedVfsService } from "../service/vfs/create-scoped-vfs-service.js";
export { createPhysicalVfsService } from "../service/vfs/create-physical-vfs-service.js";
export type { PhysicalVfsService } from "../service/vfs/physical-vfs.port.js";
export { createVfsZipIoService } from "../service/vfs/create-vfs-zip-io-service.js";
export { createCharacterCardImportService } from "../service/vfs/create-character-card-import-service.js";
export type { CreateCharacterCardImportServiceOptions } from "../service/vfs/create-character-card-import-service.js";
export { createVfsBatchIoService } from "../service/vfs/create-vfs-batch-io-service.js";
export { parseCharacterCardToMdTree } from "../domain/character-card/logic/parse-character-card-to-md-tree.js";
export { characterCardJsonToMdTree } from "../domain/character-card/logic/character-card-to-md-tree.js";
export { CharacterCardError } from "../errors/character-card-errors.js";
export type { CharacterCardErrorCode } from "../errors/character-card-errors.js";
export type { MdTree } from "../domain/character-card/model/character-card.js";
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
export type { UserVfsSaveVersionOptions } from "../service/vfs/build-user-vfs-turn-op.js";
export { buildVfsZip } from "../domain/vfs/logic/vfs-zip-build.js";
export { parseVfsZip } from "../domain/vfs/logic/vfs-zip-parse.js";
export { VfsZipError } from "../errors/vfs-zip-errors.js";
export type { VfsZipErrorCode } from "../errors/vfs-zip-errors.js";
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
  BatchExportFileEntry,
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
  WriteOptions,
  VfsGrepMatch,
} from "../domain/vfs/ports/vfs-service.port.js";
export type { VfsScope } from "../domain/vfs/logic/vfs-path-mapper.js";
export {
  resolveLogicalPath,
  assertLogicalPathAllowed,
  toPhysicalPath,
  toLogicalPath,
  scopePhysicalPrefix,
  projectVfsPrefix,
} from "../domain/vfs/logic/vfs-path-mapper.js";
export {
  moveVfsPath,
  remapPathUnderDir,
  normalizeDirPath,
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
export { formatVfsErrorForUser } from "../domain/vfs/logic/format-vfs-error-for-user.js";
export type {
  UserVfsSaveMappingOptions,
  UserVfsEditHunk,
  UserVfsSaveMappingResult,
} from "../domain/vfs/logic/user-vfs-save-mapping.js";
export { actionXmlToToolUses } from "../domain/vfs/logic/action-xml-to-tool-uses.js";
export type { DerivedToolUseInput } from "../domain/vfs/logic/action-xml-to-tool-uses.js";
