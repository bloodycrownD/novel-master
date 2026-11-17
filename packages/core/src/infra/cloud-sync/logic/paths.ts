/**
 * 云同步远端对象路径规范化与键名生成。
 *
 * @module infra/cloud-sync/logic/paths
 */

/**
 * 规范化路径前缀：非空时确保以 `/` 结尾。
 *
 * 与 `domain/vfs/repositories/impl/scope-prefix-helpers.ts` 的 `stripTrailingSlash`
 * **语义相反**（那边去尾斜杠），两者不可互替（nm-code-style §5.4 / §9.4 已登记的同名反义先例）。
 */
export function ensureTrailingSlash(prefix: string): string {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/** 生成 status.json 对象键 */
export function statusKey(prefix: string): string {
  return `${ensureTrailingSlash(prefix)}status.json`;
}

/**
 * 生成快照对象键：`{prefix}snapshots/rev-{6位零填充}.nmbackup`
 */
export function snapshotKey(prefix: string, rev: number): string {
  const revPart = String(rev).padStart(6, "0");
  return `${ensureTrailingSlash(prefix)}snapshots/rev-${revPart}.nmbackup`;
}
