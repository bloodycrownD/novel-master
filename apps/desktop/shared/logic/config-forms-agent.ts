/**
 * Desktop renderer 对 `@novel-master/core/config-forms/agent` 的具名薄再导出。
 * 禁止 `export *`。
 */

export type { ToolsMode } from "@novel-master/core/config-forms/agent";

export {
  blockTypeLabel,
  buildAgentDefinitionFromForm,
  BUILTIN_TOOL_CATALOG,
  countEffectiveFormPromptSources,
  countFormPromptSources,
  createDefaultDynamicTextBlock,
  createDefaultPersistTextBlock,
  DEFAULT_WORKPLACE_ASSISTANT_TEXT,
  definitionToForm,
  deletePersistTextBlock,
  formSnapshotJson,
  hasAnyPromptRegionEnabled,
  isDynamicBlockPersistent,
  mapPersistTextBlocks,
  movePersistTextBlock,
  PROMPT_REGION_LABELS,
  ROLE_OPTIONS,
  TOOL_MODE_OPTIONS,
  toolsSelectionFromDefinition,
  withDynamicBlockPersistence,
  withWorkplaceToggle,
  WORKPLACE_ASSISTANT_TEXT_LABEL,
  WORKPLACE_BLOCK_HINT,
  WORKPLACE_BLOCK_LABEL,
} from "@novel-master/core/config-forms/agent";
