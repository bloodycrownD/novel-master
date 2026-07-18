/**
 * Session KKV 行模型。
 *
 * @module domain/session-kkv/model/session-kkv-entry
 */

/** 会话作用域下的键值行。 */
export interface SessionKkvEntry {
  readonly sessionId: string;
  readonly domain: string;
  readonly key: string;
  readonly value: string;
}
