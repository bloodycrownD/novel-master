/**
 * CLI: read a single-agent config file via parseText + decode.
 *
 * @module config/load-agent-config-file
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { decode, parseText, type TextFormat } from "@novel-master/core";
import { type AppError, Result } from "@novel-master/core/errors";

import { agentDefinitionSchema, type AgentDefinition } from "@novel-master/core/agent";

function formatFromPath(path: string): TextFormat {
  const ext = extname(path).toLowerCase();
  if (ext === ".json") {
    return "json";
  }
  return "yaml";
}

/**
 * Loads one agent from a single-agent config path; 文本解析与 schema decode
 * 的已知失败沿 `Result.err` 回传（文件不存在等 IO 异常仍抛，由命令边界收口）。
 */
export async function loadAgentFromConfig(
  path: string,
): Promise<Result<AgentDefinition, AppError>> {
  const source = await readFile(path, "utf8");
  const format = formatFromPath(path);
  const parsed = parseText(source, format);
  if (!parsed.ok) return Result.err(parsed.error);
  return decode(parsed.value, agentDefinitionSchema);
}
