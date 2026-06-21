/**
 * Prompt 组装、校验与 LLM 导出相关的公开入口。
 *
 * @module public/prompt
 */

export { PromptError } from "../errors/prompt-errors.js";
export type { PromptErrorCode } from "../errors/prompt-errors.js";
export type {
  AgentPromptLayout,
  PersistPromptBlock,
  DynamicPromptBlock,
  PersistTextPromptBlock,
  PersistWorktreePromptBlock,
} from "../domain/prompt/model/agent-prompt-layout.js";
export { shouldIncludeDynamicBlock } from "../domain/prompt/logic/should-include-dynamic-block.js";
export { messageBodyText } from "../domain/prompt/logic/message-body.js";
export {
  validateAgentPromptLayoutFromMaps,
  validateAgentPromptLayout,
} from "../domain/prompt/logic/validate-agent-prompt-layout.js";
export { normalizeForLlmExport } from "../domain/prompt/logic/normalize-for-llm-export.js";
export type {
  LlmExportZones,
  LlmExportZone,
} from "../domain/prompt/logic/normalize-for-llm-export.js";
export { validateDynamicMacros } from "../domain/prompt/logic/validate-dynamic-macros.js";
export { expandDynamicMacros } from "../domain/prompt/logic/expand-dynamic-macros.js";
export {
  buildPromptAssemblyFromLayout,
  buildPromptLlmInputFromLayout,
  computeLlmExportZonesFromLayout,
  formatPromptLlmInputForCliFromLayout,
  buildPromptPreviewSegmentsFromLayout,
} from "../service/prompt/render-prompt.js";
export type {
  PromptAssemblySegment,
  PromptAssemblyOptions,
  PromptPreviewSegment,
} from "../service/prompt/render-prompt.js";
export type {
  PromptRenderContext,
  PromptLlmInput,
} from "../domain/prompt/model/prompt-render-context.js";
