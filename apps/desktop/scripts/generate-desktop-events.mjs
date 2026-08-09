#!/usr/bin/env node
/**
 * 已不需要——renderer 现在直接 import `@novel-master/core/events` 的类型（type-only，编译期擦除）。
 * 本脚本保留作为可选的 renderer 子集 lint 约束：手动跑一遍可以校验 core 仍然导出了这 7 个
 * agent 事件常量 + 8 个载荷类型（见下方 agentEventNames / agentTypes 列表），core 一旦
 * 漏导就会抛错。不再绑定到 npm script，也不再生成 `shared/agent-event-types.ts`。
 *
 * 源：packages/core/src/domain/events/model/event-types.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const sourcePath = path.join(
  repoRoot,
  "packages/core/src/domain/events/model/event-types.ts",
);


const source = readFileSync(sourcePath, "utf8");

const agentEventNames = [
  "EVENT_AGENT_RUN_STARTED",
  "EVENT_AGENT_RUN_FINISHED",
  "EVENT_AGENT_RUN_FAILED",
  "EVENT_AGENT_STREAM_TEXT_DELTA",
  "EVENT_AGENT_STREAM_THINKING_DELTA",
  "EVENT_AGENT_STREAM_TOOL_USE",
  "EVENT_AGENT_STEP_COMMITTED",
];

const agentTypes = [
  "AgentRunStartedPayload",
  "AgentRunFinishedPayload",
  "AgentRunFailedPayload",
  "AgentStreamTextDeltaPayload",
  "AgentStreamThinkingDeltaPayload",
  "AgentStreamToolUsePayload",
  "AgentStepCommittedPhase",
  "AgentStepCommittedPayload",
];

/** @param {"const" | "type" | "interface"} kind */
function extractBlock(name, kind) {
  const pattern =
    kind === "const"
      ? new RegExp(`export const ${name}\\s*=\\s*[\\s\\S]*? as const;`, "m")
      : kind === "type"
        ? new RegExp(`export type ${name} = [^;]+;`, "s")
        : new RegExp(`export interface ${name} \\{[\\s\\S]*?\\}`, "m");
  const match = source.match(pattern);
  if (match == null) {
    throw new Error(`无法在 core event-types.ts 中找到 ${kind} ${name}`);
  }
  return match[0];
}

// 校验：core 仍导出了上述全部常量与类型。一旦 core 漏导，extractBlock 会抛错，
// 提醒补回导出。不再回写 shared/agent-event-types.ts（那份手抄副本已删，renderer 直
// 接 import core 类型）。
for (const name of agentEventNames) {
  extractBlock(name, "const");
}
for (const name of agentTypes) {
  if (name === "AgentStepCommittedPhase") {
    extractBlock(name, "type");
  } else {
    extractBlock(name, "interface");
  }
}

console.log(
  "已校验 core event-types.ts 仍导出上述 " +
    `${agentEventNames.length} 个常量 + ${agentTypes.length} 个类型` +
    "（未生成 shared/agent-event-types.ts，renderer 直接 import core）。",
);
