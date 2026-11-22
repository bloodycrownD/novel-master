/**
 * {@link PersistentPreferences} factory.
 *
 * @module service/persistent-preferences/create-persistent-preferences
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import { DefaultPersistentPreferences } from "./impl/persistent-preferences.service.js";
import type { PersistentPreferences } from "./persistent-preferences.port.js";

/**
 * Creates preference storage on `nm-preferences`.
 *
 * @param conn - Open connection after {@link NovelMasterBootstrap.bootstrap}
 *
 * nm-style: keep-bare — 三端 runtime 装配线共用的偏好存储工厂（单文件单函数），p23 重复组与 p24 主体桶均不在收口范围。
 */
export function createPersistentPreferences(conn: TdbcConnection): PersistentPreferences {
    const kkv = createKkvService(conn);
    return new DefaultPersistentPreferences(kkv);
}
