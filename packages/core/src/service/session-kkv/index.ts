/**
 * Session KKV 工厂与端口（会话级规则快照 / 文件缓存）。
 *
 * @module service/session-kkv
 */

export { createSessionKkvService } from "./create-session-kkv-service.js";
export type { SessionKkvService } from "./session-kkv.port.js";
export {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  RULE_SNAPSHOT_CANON_KEY,
  fileCacheKey,
  type WorkplaceDisplayStatus,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
