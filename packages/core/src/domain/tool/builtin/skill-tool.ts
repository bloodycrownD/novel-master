/**
 * `skill_opt` 工具实现：读取与管理两域技能（read / write / edit / list）。
 *
 * 形态照 `fs` 工具先例——单工具多 action 分发 + 扁平显式字段。
 * 工具内部经 `ctx.skills` 闭包调 {@link SkillService}，**不直接持有 vfs**；
 * path 禁 `..` 校验（schema refine 先行拦截，服务层 resolveSkillRelPath 兜底）。
 *
 * description 是 lambda（照 `subagent-tool` 先例）：从装配期预算好的
 * `ctx.skills.effective` 清单拼「可用技能」文案。求值时机 `toolsFromRegistry`
 * 每 run 一次——回合内技能启停不即时反映，与 task 工具一致，有意行为。
 *
 * @module domain/tool/builtin/skill-tool
 */

import { z } from "zod";

import type { EffectiveSkill } from "@/domain/skills/logic/effective-skills.js";
import type { SkillService } from "@/service/skills/skills.port.js";
import { ToolError } from "@/errors/tool-errors.js";
import type { Tool } from "../model/tool.js";
import type { BuiltinToolContext } from "./builtin-tool-context.js";
import {
  capUtf8Bytes,
  sliceLinesFromOffset,
  TOOL_OUTPUT_MAX_LINES,
  truncateLine,
} from "../logic/tool-output-limits.js";

/** 工具注册名（catalog / policy / 卡片解析四处同名字符串）。 */
export const SKILL_TOOL_NAME = "skill_opt";

/** 技能入口文件（`path` 缺省值，与服务层 SKILL_ENTRY_FILE 同值）。 */
const SKILL_DEFAULT_ENTRY = "SKILL.md";

/** `skill_opt` 工具输入（扁平显式字段；action 决定哪些字段必填，run 内校验）。 */
export interface SkillToolInput {
  readonly action: "read" | "write" | "edit" | "list";
  readonly name?: string;
  readonly domain?: "global" | "project";
  /** 相对技能目录的路径，缺省 SKILL.md；禁 `..` 段。 */
  readonly path?: string;
  /** write 必填：整文件内容。 */
  readonly content?: string;
  /** edit 必填：匹配串（语义同 edit 工具的 normalize-for-match）。 */
  readonly oldString?: string;
  /** edit 必填：替换串。 */
  readonly newString?: string;
  readonly replaceAll?: boolean;
  /** read 分页参数（照 read 工具；offset 1-based）。 */
  readonly offset?: number;
  readonly limit?: number;
}

/** read 输出（`domain` 是生效副本解析后的实际命中域）。 */
export interface SkillToolReadOutput {
  readonly action: "read";
  readonly domain: "global" | "project";
  readonly name: string;
  readonly path: string;
  readonly content: string;
  readonly version: number;
  readonly offset: number;
  readonly limit: number;
  readonly totalLines: number;
  readonly returnedLines: number;
  readonly truncated: boolean;
  readonly nextOffset?: number;
}

/** write / edit / list 输出（write/edit 带定位三元组供摘要与 meta 透传）。 */
export interface SkillToolWriteOutput {
  readonly action: "write";
  readonly domain: "global" | "project";
  readonly name: string;
  readonly path: string;
  readonly version: number;
}

export interface SkillToolEditOutput {
  readonly action: "edit";
  readonly domain: "global" | "project";
  readonly name: string;
  readonly path: string;
  readonly version: number;
  readonly replacements: number;
}

export interface SkillToolListOutput {
  readonly action: "list";
  readonly entries: readonly {
    readonly name: string;
    readonly description?: string;
    readonly domain: "global" | "project";
    readonly valid: boolean;
    readonly disabled?: boolean;
    readonly overridden?: boolean;
  }[];
  readonly total: number;
}

export type SkillToolOutput =
  | SkillToolReadOutput
  | SkillToolWriteOutput
  | SkillToolEditOutput
  | SkillToolListOutput;

/** 校验非空必填字符串字段，缺失时抛 INVALID_ARGUMENT（错误文案带字段名）。 */
function requireString(
  action: SkillToolInput["action"],
  field: string,
  value: string | undefined,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `skill_opt 的 ${action} 动作必须提供非空 ${field}`,
      { toolName: SKILL_TOOL_NAME },
    );
  }
  return value;
}

/** 从装配期预算好的生效清单拼给 LLM 看的「可用技能」文案（照 formatCallableList）。 */
function formatEffectiveSkills(
  effective: readonly EffectiveSkill[],
): string {
  const usable = effective.filter((s) => s.effective);
  if (usable.length === 0) return "（暂无可用技能）";
  return usable
    .map((s) =>
      s.description != null && s.description.trim().length > 0
        ? `- ${s.name}：${s.description.trim()}`
        : `- ${s.name}`,
    )
    .join("\n");
}

/**
 * 静态 `skill_opt` 工具实例。
 *
 * 域缺省语义：read 缺省读生效副本（项目副本优先回落 global，由 SkillService
 * 解析，输出携带实际命中域）；write / edit 缺省写 project 域（服务层要求
 * 显式域，工具层补默认值）；list 缺省列当前项目合并视图。
 */
export const skillTool: Tool<SkillToolInput, SkillToolOutput, BuiltinToolContext> =
  {
    name: SKILL_TOOL_NAME,
    description: (ctx) => {
      const effective = ctx.skills?.effective ?? [];
      return `读取与管理技能（Skills）。技能是可复用的提示词包（SKILL.md + 附属文件），通过本工具查看或修改其内容。

当前可用技能（装配期快照，回合内变更不即时反映）：
${formatEffectiveSkills(effective)}

action 说明：
- read：读取技能文件。name 必填；path 缺省 SKILL.md；domain 缺省读生效副本（项目副本优先，输出 domain 为实际命中域）
- write：整文件覆盖写入。name / content 必填；domain 缺省 project；向新目录写 SKILL.md 即新建技能
- edit：局部查找替换。name / oldString / newString 必填（可配 replaceAll）；domain 缺省 project
- list：列技能清单。domain 缺省列当前项目合并视图（含禁用/覆盖标记）；显式 domain 列对应域

参数说明：
- name：技能名（list 不需要）
- domain：global（全部项目共享）或 project（仅当前项目）
- path：相对技能目录的路径，不得包含 ..

注意：技能文件跨域读写不进会话工作区；修改只影响技能本身，不改当前会话文件。`;
    },
    inputSchema: z.object({
      action: z
        .enum(["read", "write", "edit", "list"])
        .describe("动作类型：read 读取 / write 覆盖写 / edit 局部替换 / list 列清单"),
      name: z
        .string()
        .min(1)
        .optional()
        .describe("技能名（read/write/edit 必填；list 不需要）"),
      domain: z
        .enum(["global", "project"])
        .optional()
        .describe("技能域；read 缺省生效副本，write/edit 缺省 project，list 缺省合并视图"),
      path: z
        .string()
        .refine((p) => !p.split("/").includes(".."), {
          message: "技能文件路径不得包含 ..",
        })
        .optional()
        .describe("相对技能目录的路径，缺省 SKILL.md，不得包含 .."),
      content: z.string().optional().describe("write 动作的整文件内容"),
      oldString: z.string().optional().describe("edit 动作的匹配串"),
      newString: z.string().optional().describe("edit 动作的替换串"),
      replaceAll: z.boolean().optional().describe("edit 动作是否替换全部匹配"),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("read 分页起始行（1-based）"),
      limit: z.number().int().min(1).optional().describe("read 分页行数上限"),
    }),
    outputSchema: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("read"),
        domain: z.enum(["global", "project"]),
        name: z.string(),
        path: z.string(),
        content: z.string(),
        version: z.number(),
        offset: z.number().int(),
        limit: z.number().int(),
        totalLines: z.number().int(),
        returnedLines: z.number().int(),
        truncated: z.boolean(),
        nextOffset: z.number().int().optional(),
      }),
      z.object({
        action: z.literal("write"),
        domain: z.enum(["global", "project"]),
        name: z.string(),
        path: z.string(),
        version: z.number(),
      }),
      z.object({
        action: z.literal("edit"),
        domain: z.enum(["global", "project"]),
        name: z.string(),
        path: z.string(),
        version: z.number(),
        replacements: z.number().int(),
      }),
      z.object({
        action: z.literal("list"),
        entries: z.array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            domain: z.enum(["global", "project"]),
            valid: z.boolean(),
            disabled: z.boolean().optional(),
            overridden: z.boolean().optional(),
          }),
        ),
        total: z.number().int(),
      }),
    ]),
    async run(input, ctx): Promise<SkillToolOutput> {
      const skills = ctx.skills;
      if (skills == null) {
        throw new ToolError(
          "FAILED",
          "skill_opt 工具未装配 skills 上下文（当前运行时未注入技能服务）",
          { toolName: SKILL_TOOL_NAME },
        );
      }
      const service: SkillService = skills.service;

      switch (input.action) {
        case "read": {
          const name = requireString("read", "name", input.name);
          const result = await service.readSkillFile(
            input.domain,
            name,
            input.path,
            skills.projectId,
          );
          const offset = input.offset ?? 1;
          const limit = input.limit ?? TOOL_OUTPUT_MAX_LINES;
          const lines = result.content.split("\n");
          const totalLines = lines.length;
          if (totalLines > 0 && offset > totalLines) {
            throw new ToolError(
              "INVALID_ARGUMENT",
              `offset ${offset} exceeds file length (${totalLines} lines)`,
              { toolName: SKILL_TOOL_NAME },
            );
          }
          const { slice, nextOffset: lineNextOffset } = sliceLinesFromOffset(
            lines,
            offset,
            limit,
          );
          const truncatedLines = slice.map((line) => truncateLine(line).line);
          const byteCapped = capUtf8Bytes(truncatedLines);
          const content = byteCapped.lines.join("\n");
          const returnedLines = byteCapped.lines.length;
          const truncated =
            byteCapped.truncated ||
            returnedLines < slice.length ||
            (lineNextOffset != null && returnedLines >= limit);
          let nextOffset: number | undefined;
          if (truncated) {
            if (byteCapped.truncated && returnedLines > 0) {
              nextOffset = offset + returnedLines;
            } else if (lineNextOffset != null) {
              nextOffset = lineNextOffset;
            }
          }
          return {
            action: "read",
            domain: result.domain,
            name,
            path: result.path,
            content,
            version: result.version,
            offset,
            limit,
            totalLines,
            returnedLines,
            truncated,
            ...(nextOffset != null ? { nextOffset } : {}),
          };
        }
        case "write": {
          const name = requireString("write", "name", input.name);
          const content = requireString("write", "content", input.content);
          const domain = input.domain ?? "project";
          const path = input.path ?? SKILL_DEFAULT_ENTRY;
          const { version } = await service.writeSkillFile(
            domain,
            name,
            input.path,
            content,
            skills.projectId,
          );
          return { action: "write", domain, name, path, version };
        }
        case "edit": {
          const name = requireString("edit", "name", input.name);
          const oldString = requireString("edit", "oldString", input.oldString);
          const newString = requireString("edit", "newString", input.newString);
          const domain = input.domain ?? "project";
          const path = input.path ?? SKILL_DEFAULT_ENTRY;
          const result = await service.editSkillFile(
            domain,
            name,
            input.path,
            { oldString, newString, replaceAll: input.replaceAll },
            skills.projectId,
          );
          return {
            action: "edit",
            domain,
            name,
            path,
            version: result.version,
            replacements: result.replacements,
          };
        }
        case "list": {
          if (input.domain == null) {
            // 缺省列合并视图（当前项目视角的生效清单，含禁用/覆盖标记）
            const effective = await service.effectiveSkills(skills.projectId);
            return {
              action: "list",
              entries: effective.map((s) => ({
                name: s.name,
                ...(s.description != null ? { description: s.description } : {}),
                domain: s.domain,
                valid: s.valid,
                ...(s.disabled ? { disabled: true } : {}),
                ...(s.overridden ? { overridden: true } : {}),
              })),
              total: effective.length,
            };
          }
          const items = await service.listSkills(
            input.domain === "global"
              ? "global"
              : { projectId: skills.projectId },
          );
          return {
            action: "list",
            entries: items.map((s) => ({
              name: s.name,
              ...(s.description != null ? { description: s.description } : {}),
              domain: s.domain,
              valid: s.valid,
            })),
            total: items.length,
          };
        }
      }
    },
  };
