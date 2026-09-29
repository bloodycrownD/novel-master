/**
 * Session KKV 仓储端口。
 *
 * @module domain/session-kkv/repositories/session-kkv.port
 */

import type { SessionKkvEntry } from "../model/session-kkv-entry.js";

/**
 * `session_kkv_entry` 持久化契约。
 */
export interface SessionKkvRepository {
  get(
    sessionId: string,
    domain: string,
    key: string
  ): Promise<SessionKkvEntry | null>;

  /**
   * 批量按键读值（miss 键不进结果）。file_cache 域两条 IN 查询完成全部
   * 键——workplace 组装等 N 键消费方的读链从 2N 条串行 SQL 收敛到常数条。
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

  delete(sessionId: string, domain: string, key: string): Promise<boolean>;

  /** 删除该会话下指定 domain 的全部行。 */
  clearDomain(sessionId: string, domain: string): Promise<void>;

  /** 删除该会话下全部行（所有 domain）。 */
  clearSession(sessionId: string): Promise<void>;

  listKeys(sessionId: string, domain: string): Promise<string[]>;
}
