/**
 * 存储配置有效性判定与恢复辅助（对外子入口）。
 *
 * @module config-forms/stored-config-validity
 */

export * from "./types.js";
export * from "./labels.js";
export { assessEventsConfigWire } from "./assess-events-config-wire.js";
export {
  assessAgentDefinitionWire,
  resolveAgentDefinitionFromStorage,
} from "./assess-agent-definition-wire.js";
export { buildDefaultAgentDefinitionPreservingName } from "./build-default-agent-definition.js";
