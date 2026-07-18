/**
 * Session KKV 应用服务端口。
 *
 * @module service/session-kkv/session-kkv.port
 */

/**
 * 会话生命周期内的键值存储（规则快照 / 文件缓存 / user_vfs_pending 等域）。
 *
 * @remarks
 * - {@link get} 缺失时返回 `null`（不抛错），便于 assemble 判断空快照。
 * - {@link clearSession} 在 session 删除 / 置位 / 压缩成功后调用。
 * - fork / copy 会话**不**复制本表行。
 */
export interface SessionKkvService {
  get(
    sessionId: string,
    domain: string,
    key: string,
  ): Promise<string | null>;

  set(
    sessionId: string,
    domain: string,
    key: string,
    value: string,
  ): Promise<void>;

  delete(sessionId: string, domain: string, key: string): Promise<void>;

  clearSession(sessionId: string): Promise<void>;

  listKeys(sessionId: string, domain: string): Promise<string[]>;
}
