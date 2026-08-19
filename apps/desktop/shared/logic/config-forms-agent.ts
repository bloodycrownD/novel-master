/**
 * Desktop renderer 对 `@novel-master/core/config-forms/agent` 的具名薄再导出。
 * 禁止 `export *`。
 */

export type { AgentMode, ToolsMode } from "@novel-master/core/config-forms/agent";

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
  MODE_OPTIONS,
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
  WORKPLACE_DISABLED_HINT,
} from "@novel-master/core/config-forms/agent";
