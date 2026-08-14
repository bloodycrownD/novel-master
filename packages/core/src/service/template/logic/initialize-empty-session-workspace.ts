/**
 * 为 session 初始化空工作区（不拷贝项目模板、不拷贝父快照）。
 *
 * 与 {@link initializeSessionWorkspace} 的区别：后者会从 project template 拷贝整棵
 * VFS + workplace project scope，带进来一整套项目模板文件；本函数只保证目标
 * session 的 VFS scope 起点为空——幂等清理可能残留的 entry，不写入任何文件、
 * 不复制任何 scope。
 *
 * 使用场景：`createSubSession`——子会话工作区按 PRD「从空开始」的要求初始化，
 * 子 agent 加载到的工作区与其提示词上下文一致（不携带父会话的工具调用历史快照）。
 *
 * KKV（`rule_snapshot` / `file_cache`）无需显式预写：`sessionKkv.get` 缺失时返回
 * `null`，天然满足「空快照」。本函数只清 VFS entry，不动 KKV 表（子 session 新
 * 建时本就没有 KKV 行）。
 *
 * @module service/template/logic/initialize-empty-session-workspace
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { deleteVfsPrefix } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";

/**
 * 将 session 的 VFS scope 重置为空（幂等：scope 本就为空时是 no-op）。
 *
 * @param tx - 事务连接（对齐 {@link initializeSessionWorkspace} 的事务约定）
 * @param projectId - 项目 id
 * @param sessionId - 子 session id
 */
export async function initializeEmptySessionWorkspace(
  tx: TdbcConnection,
  projectId: string,
  sessionId: string,
): Promise<void> {
  const vfs = new SqliteVfsEntryRepository(tx);
  // 幂等清理：确保子 session scope 没有任何残留 entry。正常情况下新建子 session
  // 时本 scope 是空的，这步是 no-op；但作为「从空开始」的硬保证，防止任何上游
  // bug 导致的污染残留到子会话工作区。
  await deleteVfsPrefix(
    vfs,
    `session:${projectId}:${sessionId}`,
    "/",
  );
}
