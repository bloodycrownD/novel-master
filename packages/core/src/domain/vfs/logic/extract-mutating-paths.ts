/**
 * 从 tool 调用提取突变路径（与 ToolRunner 同源逻辑，不修改 ToolRunner）。
 *
 * @module domain/vfs/logic/extract-mutating-paths
 */

import { classifyMutatingToolCall } from "@/domain/tool/logic/fs-command-classify.js";

/** 单次 tool 调用描述。 */
export interface MutatingToolCall {
  readonly name: string;
  readonly input: unknown;
}

/**
 * 提取突变 tool 调用涉及的路径；非突变 tool 返回 null。
 */
export function extractMutatingPaths(
  call: MutatingToolCall,
): readonly string[] | null {
  return classifyMutatingToolCall(call.name, call.input).paths;
}

/** 合并一次 op 内所有突变路径（去重、保序）。 */
export function collectMutatingPathsFromCalls(
  calls: readonly MutatingToolCall[],
): readonly string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const call of calls) {
    const mutating = extractMutatingPaths(call);
    if (mutating == null) {
      continue;
    }
    for (const path of mutating) {
      if (!seen.has(path)) {
        seen.add(path);
        paths.push(path);
      }
    }
  }
  return paths;
}
