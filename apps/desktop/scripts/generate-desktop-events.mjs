#!/usr/bin/env node
/**
 * 从 packages/core event-types.ts 生成 apps/desktop/shared/agent-event-types.ts。
 * renderer 禁止手改生成文件。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const sourcePath = path.join(
  repoRoot,
  "packages/core/src/domain/events/model/event-types.ts",
);
const outPath = path.join(repoRoot, "apps/desktop/shared/agent-event-types.ts");

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

const header = `/**
 * Agent stream IPC 事件名与载荷（renderer 安全；由脚本生成，禁止手改）。
 * 生成：npm run generate:desktop-events -w @novel-master/desktop
 * 源：packages/core/src/domain/events/model/event-types.ts
 */

`;

const body = [
  ...agentEventNames.map((n) => extractBlock(n, "const")),
  "",
  ...agentTypes.map((n) => {
    if (n === "AgentStepCommittedPhase") {
      return extractBlock(n, "type");
    }
    return extractBlock(n, "interface");
  }),
].join("\n");

writeFileSync(outPath, `${header}${body}\n`, "utf8");
console.log(`已生成 ${path.relative(repoRoot, outPath)}`);
