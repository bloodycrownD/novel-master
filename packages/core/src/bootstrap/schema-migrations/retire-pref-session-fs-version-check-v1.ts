/**
 * retire-pref-session-fs-version-check-v1：一次性清理存量偏好死键。
 *
 * 背景：VFS 写入的版本校验整体下线后，偏好键 `session-fs.versionCheck`
 * 的读写三件套（读取、写入、KNOWN_KEYS 登记）已删除，但存量用户库
 * kkv_entry 表里 module='nm-preferences'、key='session-fs.versionCheck'
 * 的行还在——无读者、无写者，且 preferences.list() 会把它列出来，
 * 混淆排查。
 *
 * 清理：DELETE 掉该行。走 migration runner 而非 canonical DDL：runner
 * 在 bootstrap 快/慢两条路径都会执行，经 schema_migrations 表 applied
 * 去重天然只跑一次，且无需 bump SCHEMA_BOOT_VERSION（纯数据清理，
 * 不涉 DDL/列对齐合同）。
 *
 * 幂等：DELETE 天然幂等（键不存在时 changes=0），再加 schema_migrations
 * 表按 id 去重（runner 自带），双重保险。
 *
 * @module bootstrap/schema-migrations/retire-pref-session-fs-version-check-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { PREFERENCES_MODULE } from "@/service/persistent-preferences/impl/preference-keys.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const RETIRE_PREF_SESSION_FS_VERSION_CHECK_V1_ID =
  "retire-pref-session-fs-version-check-v1";

/** 已下线的偏好键（VFS 版本校验偏好，读写三件套已删除）。 */
const RETIRED_PREF_KEY = "session-fs.versionCheck";

async function up(tx: TdbcConnection): Promise<void> {
  // module 值取 PREFERENCES_MODULE 常量，与偏好读写链路同源防漂移；
  // key 用参数绑定，不拼进 SQL 文本。
  const result = await tx.execute(
    `DELETE FROM kkv_entry WHERE module = ? AND key = ?`,
    [PREFERENCES_MODULE, RETIRED_PREF_KEY]
  );
  const deleted = Number(result.changes);
  if (deleted > 0) {
    console.log(
      `[nm-boot] ${RETIRE_PREF_SESSION_FS_VERSION_CHECK_V1_ID}: 清理死键 ${PREFERENCES_MODULE}/${RETIRED_PREF_KEY}（${deleted} 行）`
    );
  }
}

/** 存量偏好死键一次性清理 migration。 */
export const retirePrefSessionFsVersionCheckV1Migration: SchemaMigration = {
  id: RETIRE_PREF_SESSION_FS_VERSION_CHECK_V1_ID,
  up,
};
