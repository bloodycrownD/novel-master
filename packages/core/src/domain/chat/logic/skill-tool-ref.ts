/**
 * `skill` 工具卡片跳转三元组解析：从 tool_use 输入 / 工具输出解析
 * domain + projectId + name。
 *
 * 对称 `resolveVfsToolFilePath`（`domain/tool/logic/vfs-tool-file-path.ts`）
 * 的输入侧解析：write/edit 的三元组必含于 tool_use 输入，这里直接读；
 * read 缺省域命中生效副本时，实际命中域由工具输出携带，经
 * `buildToolResultBlock` 透传到 `ToolResultBlock.meta.skillRef`（本模块的
 * `resolveSkillToolRefFromOutput` 供其自动检测）。
 *
 * @module domain/chat/logic/skill-tool-ref
 */

import type { SkillToolRef } from "@/domain/chat/model/content-block.js";

/** 与 `domain/tool/builtin/skill-tool.ts` 的注册名同字符串（四处同名字符串之一）。 */
const SKILL_TOOL_NAME = "skill";

/** 输入里可解析出跳转三元组的 action（list 无目标技能，不产生跳转）。 */
const REF_ACTIONS: ReadonlySet<string> = new Set(["read", "write", "edit"]);

function parseDomain(raw: unknown): "global" | "project" | undefined {
  return raw === "global" || raw === "project" ? raw : undefined;
}

function parseName(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/**
 * 从 tool_use 输入解析技能跳转三元组（供 UI 卡片「跳详情」门控使用）。
 *
 * - 仅 `skill` 处理；action 为 list、name 非非空字符串时返回 undefined，不抛错。
 * - domain 缺省：write/edit 补工具同款默认 `project`；read 缺省读生效副本，
 *   实际命中域只有工具输出知道——此时返回 undefined，等 `meta.skillRef`。
 * - `projectId` 仅 project 域携带（global 域剥离，避免误导跳转）。
 */
export function resolveSkillToolRefFromInput(
  toolName: string,
  input: Record<string, unknown> | null | undefined,
  projectId?: string,
): SkillToolRef | undefined {
  if (toolName !== SKILL_TOOL_NAME) return undefined;
  const action = input?.action;
  if (typeof action !== "string" || !REF_ACTIONS.has(action)) return undefined;
  const name = parseName(input?.name);
  if (name == null) return undefined;
  const domain =
    parseDomain(input?.domain) ?? (action === "read" ? undefined : "project");
  if (domain == null) return undefined;
  return {
    domain,
    name,
    ...(domain === "project" && projectId != null ? { projectId } : {}),
  };
}

/**
 * 从 skill 工具输出解析跳转三元组（供 `buildToolResultBlock` 自动检测
 * 透传进 `meta.skillRef`，照 `subagentSessionId` 的双来源模式）。
 *
 * read/write/edit 成功输出均携带实际 domain/name；list 输出无目标技能。
 * `projectId` 输出里不带，由调用方按会话上下文补（仅 project 域）。
 */
export function resolveSkillToolRefFromOutput(
  toolName: string,
  output: unknown,
  projectId?: string,
): SkillToolRef | undefined {
  if (toolName !== SKILL_TOOL_NAME) return undefined;
  if (output == null || typeof output !== "object" || Array.isArray(output)) {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  if (
    record.action !== "read" &&
    record.action !== "write" &&
    record.action !== "edit"
  ) {
    return undefined;
  }
  const domain = parseDomain(record.domain);
  const name = parseName(record.name);
  if (domain == null || name == null) return undefined;
  return {
    domain,
    name,
    ...(domain === "project" && projectId != null ? { projectId } : {}),
  };
}
