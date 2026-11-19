/**
 * {@link PersistentState} factory.
 *
 * @module service/persistent-state/create-persistent-state
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import { SessionKkvServiceFactory } from "@/service/session-kkv/create-session-kkv-service.js";
import { DefaultPersistentState } from "./impl/persistent-state.service.js";
import type { PersistentState } from "./persistent-state.port.js";

/** PersistentState 工厂集合。 */
export const PersistentStateFactory = {
  /**
   * Creates workspace pointer persistence on `nm-workspace-state`.
   *
   * 会话 KKV（切模型 / 切 Agent 后失效该会话的 API prompt 占用用）由工厂**内部自建**，
   * 调用方不再有注入口子 —— 全仓调用方一律单参，注入从未发生。
   *
   * @param conn - Open connection after {@link NovelMasterBootstrap.bootstrap}
   */
  create(conn: TdbcConnection): PersistentState {
    const kkv = createKkvService(conn);
    const sessionKkv = SessionKkvServiceFactory.create(conn);
    return new DefaultPersistentState(kkv, sessionKkv);
  },
} as const;
