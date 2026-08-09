/**
 * 会话级 KKV（规则快照 / 文件缓存 / 待落盘 VFS 队列等域）的公开入口。
 *
 * 下游通过 `@novel-master/core/session-kkv` 子路径消费本 barrel，
 * 这里收拢工厂、端口以及各 domain 的 key/常量导出。
 *
 * @module public/session-kkv
 */

export { createSessionKkvService } from "../service/session-kkv/create-session-kkv-service.js";
export type { SessionKkvService } from "../service/session-kkv/session-kkv.port.js";
export {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  SESSION_KKV_DOMAIN_USER_VFS_PENDING,
  SESSION_KKV_COMPOSER_STATUS_DOMAINS,
  RULE_SNAPSHOT_CANON_KEY,
  USER_VFS_PENDING_QUEUE_KEY,
  fileCacheKey,
  type WorkplaceDisplayStatus,
} from "../domain/session-kkv/model/session-kkv-domains.js";