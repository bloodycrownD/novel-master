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

