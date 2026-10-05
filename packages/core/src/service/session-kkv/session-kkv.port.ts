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
 * - {@link clearSession} 在 session 删除 / 手动重置常驻缓存时调用（整表清，含 pending）。
 * - 置位成功改为 {@link clearDomain}(`rule_snapshot`)+{@link clearDomain}(`file_cache`)，保留 pending（压缩仅手动 trigger 清、自动不清——见 run-compaction 头注释）。
 * - fork / copy 会话**不**复制本表行。
 */
export interface SessionKkvService {
  get(sessionId: string, domain: string, key: string): Promise<string | null>;

  /**
   * 批量按键读值（miss 键不进结果）：N 键消费方（workplace 组装）的读链
   * 从逐键 2N 条串行 SQL 收敛到常数条 IN 查询。
   */
  getMany(
    sessionId: string,
    domain: string,
    keys: readonly string[]
  ): Promise<Map<string, string>>;

  set(
    sessionId: string,
    domain: string,
    key: string,
    value: string
  ): Promise<void>;

  delete(sessionId: string, domain: string, key: string): Promise<void>;

  /** 清空指定 domain（如 file_cache / user_vfs_pending）。 */
  clearDomain(sessionId: string, domain: string): Promise<void>;

  clearSession(sessionId: string): Promise<void>;

  listKeys(sessionId: string, domain: string): Promise<string[]>;
}
