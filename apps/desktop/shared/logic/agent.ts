/**
 * Desktop renderer 对 `@novel-master/core/agent` 的具名薄再导出。
 * 禁止 `export *`；禁止 createAgentRunner / createAgentRegistryService 等工厂。
 *
 * `AgentDefinition` 等完整定义类型在 assess IPC（Steps 11–12）后优先走 ipc-types DTO。
 */

export type { AgentDefinition } from "@novel-master/core/agent";

export {
  shouldAcceptRunEvent,
  shouldApplyTranscriptReload,
  shouldIgnoreStaleRunStarted,
  shouldReloadTranscriptOnRunEvent,
} from "@novel-master/core/agent";
