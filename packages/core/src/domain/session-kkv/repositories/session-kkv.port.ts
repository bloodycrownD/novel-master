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
    key: string,
  ): Promise<SessionKkvEntry | null>;

  set(
    sessionId: string,
    domain: string,
    key: string,
    value: string,
  ): Promise<void>;

  delete(sessionId: string, domain: string, key: string): Promise<boolean>;

  /** 删除该会话下全部行（所有 domain）。 */
  clearSession(sessionId: string): Promise<void>;

  listKeys(sessionId: string, domain: string): Promise<string[]>;
}
