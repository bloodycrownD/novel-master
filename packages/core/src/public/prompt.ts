/**
 * Prompt 组装、校验与 LLM 导出相关的公开入口。
 *
 * @module public/prompt
 */

export {
    AgentPromptLayout,
    DEFAULT_SKILLS_INDEX_PREFIX,
    DEFAULT_WORKPLACE_ASSISTANT_TEXT,
    WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT,
} from "../domain/prompt/model/agent-prompt-layout.js";
export type {
    PersistPromptBlock,
    DynamicPromptBlock,
    PersistTextPromptBlock,
} from "../domain/prompt/model/agent-prompt-layout.js";
export {
    MessageBodyText,
} from "../domain/prompt/logic/message-body.js";
export { AgentPromptLayoutValidate } from "../domain/prompt/logic/validate-agent-prompt-layout.js";
export { AgentPromptLayoutNormalize } from "../domain/prompt/logic/normalize-agent-prompt-layout.js";
export { LlmExport } from "../domain/prompt/logic/normalize-for-llm-export.js";
export type { LlmExportZones } from "../domain/prompt/logic/normalize-for-llm-export.js";
export { ThinkingContext } from "../service/prompt/apply-thinking-context-for-llm.js";
export type { ThinkingContextOptions } from "../service/prompt/apply-thinking-context-for-llm.js";
export { PreviewThinkingContext } from "../service/prompt/resolve-preview-thinking-context.js";
export type { ResolvePreviewThinkingContextInput } from "../service/prompt/resolve-preview-thinking-context.js";
export {
    ALLOWED_DYNAMIC_ROOT_MACROS,
    DynamicMacros,
} from "../domain/prompt/logic/validate-dynamic-macros.js";
export { DynamicMacrosExpansion } from "../domain/prompt/logic/expand-dynamic-macros.js";
export { PromptBuilder } from "../service/prompt/render-prompt.js";
export type {
    PromptAssemblyOptions,
    PromptPreviewTurn,
    PromptTextCardData,
    PromptToolGroupCardData,
    PromptTurnCardData,
    PromptWorkplaceCardData,
    PromptWorkplaceFileCardData,
} from "../service/prompt/render-prompt.js";
export { PromptPreviewTurns } from "../service/prompt/prompt-preview-turns.js";
export type {
    PromptRenderContext,
    PromptSkillIndexEntry,
    PromptLlmInput,
} from "../domain/prompt/model/prompt-render-context.js";
