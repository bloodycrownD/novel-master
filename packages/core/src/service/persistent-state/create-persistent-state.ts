/**
 * {@link PersistentState} factory.
 *
 * @module service/persistent-state/create-persistent-state
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import { DefaultPersistentState } from "./impl/persistent-state.service.js";
import type { PersistentState } from "./persistent-state.port.js";

/** {@link createPersistentState} 可选依赖。 */
export interface CreatePersistentStateOptions {
  /**
   * 会话 KKV：切模型 / 切 Agent 后失效该会话的 API prompt 占用用。
   *
   * 缺省时工厂内部自建一个（`SessionKkvService` 无状态、只是仓储包装），
   * 语义等价；调用方已有实例时传入可省一次构造。签名保持 `(conn, options?)`
   * 形式，CLI / desktop / mobile 三端与既有测试的单参调用不受影响。
   */
  readonly sessionKkv?: SessionKkvService | null;
}

/**
 * Creates workspace pointer persistence on `nm-workspace-state`.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 */
export function createPersistentState(
  conn: TdbcConnection,
  options?: CreatePersistentStateOptions
): PersistentState {
  const kkv = createKkvService(conn);
  const sessionKkv = options?.sessionKkv ?? createSessionKkvService(conn);
  return new DefaultPersistentState(kkv, sessionKkv);
}
