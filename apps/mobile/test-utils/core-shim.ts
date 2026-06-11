/**
 * Minimal `@novel-master/core` shim for mobile Jest tests.
 *
 * @remarks
 * The real core barrel (`packages/core/dist/index.js`) exports the prompt YAML
 * helpers which depend on the `yaml` package browser ESM entry. React Native
 * Jest preset does not transform that dependency by default, causing
 * `SyntaxError: Cannot use import statement outside a module`.
 *
 * Mobile unit tests only need error classes, so we re-export just those.
 */

export { VfsError } from "../../../packages/core/dist/errors/vfs-errors.js";
export { VfsZipError } from "../../../packages/core/dist/errors/vfs-zip-errors.js";
export { TdbcError } from "../../../packages/core/dist/infra/tdbc/errors.js";
export { KkvError } from "../../../packages/core/dist/errors/kkv-errors.js";
export { ProviderError } from "../../../packages/core/dist/errors/provider-errors.js";
export { ChatError } from "../../../packages/core/dist/errors/chat-errors.js";
export { ToolError } from "../../../packages/core/dist/errors/tool-errors.js";
export { AgentError } from "../../../packages/core/dist/errors/agent-runtime-errors.js";
export type { KkvService } from "../../../packages/core/dist/service/kkv/kkv.port.js";
export {
  matchDepth,
  validateDepthSlice,
} from "../../../packages/core/dist/domain/depth/logic/depth-slice.js";
export {
  sortDirPaths,
  sortFilesForDir,
} from "../../../packages/core/dist/domain/worktree/logic/worktree-eval.js";
export { DEFAULT_WORKTREE_DIR_RULE } from "../../../packages/core/dist/domain/worktree/logic/default-dir-rule.js";
export type {
  WorktreeDirRule,
  WorktreeListRow,
} from "../../../packages/core/dist/domain/worktree/model/worktree-types.js";
export { messageBodyText } from "../../../packages/core/dist/domain/chat/content/message-body-text.js";
export { textBlocks } from "../../../packages/core/dist/domain/chat/content/text-blocks.js";
export { ToolRegistry } from "../../../packages/core/dist/domain/tool/logic/tool-registry.js";
export {
  buildToolResultBlock,
  resolveToolResultOk,
} from "../../../packages/core/dist/domain/tool/logic/build-tool-result-block.js";
export { registerBuiltinTools } from "../../../packages/core/dist/domain/tool/builtin/register-builtin-tools.js";
export { resolveAgentToolRegistry } from "../../../packages/core/dist/domain/agent/logic/resolve-agent-tool-registry.js";
export { validateAgentDefinition } from "../../../packages/core/dist/domain/agent/logic/validate-agent-definition.js";
export { createAgentRunner } from "../../../packages/core/dist/service/agent/create-agent-runner.js";
export { ChatAgentSession } from "../../../packages/core/dist/service/agent/impl/chat-agent-session.js";
export {
  AgentRunResolveError,
  resolveCurrentAgentId,
  resolveCurrentAgentDefinition,
  resolveApplicationModelIdForRun,
} from "../../../packages/core/dist/service/agent/logic/agent-run-shared.js";
export {
  runAgentTurn,
  AgentTurnError,
} from "../../../packages/core/dist/service/agent/logic/run-agent-turn.js";
export type { AgentDefinition } from "../../../packages/core/dist/domain/agent/model/agent-definition.js";
export type { AgentRunResult } from "../../../packages/core/dist/domain/agent/model/agent-run-result.js";
