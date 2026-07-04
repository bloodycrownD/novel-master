/**
 * 从 VFS 错误 message 中剥离已知物理路径前缀（兜底脱敏）。
 *
 * @module domain/vfs/logic/strip-known-physical-prefixes
 */

const SESSION_PHYSICAL_PREFIX =
  /\/projects\/[^/]+\/sessions\/[^/]+(?=\/|$)/g;
const PROJECT_TEMPLATE_PREFIX =
  /\/projects\/[^/]+\/template(?=\/|$)/g;
const GLOBAL_TEMPLATE_PREFIX = /\/template(?=\/|$)/g;

/** 移除 message 中的 session/project/global 物理前缀片段。 */
export function stripKnownPhysicalPrefixes(message: string): string {
  return message
    .replace(SESSION_PHYSICAL_PREFIX, "")
    .replace(PROJECT_TEMPLATE_PREFIX, "")
    .replace(GLOBAL_TEMPLATE_PREFIX, "");
}
