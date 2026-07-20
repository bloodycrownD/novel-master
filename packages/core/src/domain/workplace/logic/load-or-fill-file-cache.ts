/**
 * session kkv file_cache：命中则返回；否则按档位读 VFS 并回写。
 * assemble 常驻前缀与 prepare hydrate 共用，避免双份平行实现。
 */

import {
  fileCacheKey,
  SESSION_KKV_DOMAIN_FILE_CACHE,
  type WorkplaceDisplayStatus,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import {
  parseFileCachePayload,
  serializeFileCachePayload,
  type FileCachePayload,
} from "./rule-snapshot-codec.js";

export type LoadOrFillFileCacheDeps = {
  readonly sessionId: string;
  readonly sessionKkv: SessionKkvService;
  readonly vfs: VfsService;
  readonly path: string;
  readonly status: WorkplaceDisplayStatus;
};

/** filename 不读盘；缺失用 `(missing)` 占位并仍写入 cache。 */
export async function loadOrFillFileCache(
  deps: LoadOrFillFileCacheDeps,
): Promise<FileCachePayload> {
  const key = fileCacheKey(deps.status, deps.path);
  const raw = await deps.sessionKkv.get(
    deps.sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
    key,
  );
  if (raw != null) {
    const parsed = parseFileCachePayload(raw);
    if (parsed != null) {
      return parsed;
    }
  }

  const filled = await readWorkplaceFileBody(deps.path, deps.status, deps.vfs);
  await deps.sessionKkv.set(
    deps.sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
    key,
    serializeFileCachePayload(filled),
  );
  return filled;
}

async function readWorkplaceFileBody(
  path: string,
  status: WorkplaceDisplayStatus,
  vfs: VfsService,
): Promise<FileCachePayload> {
  if (status === "filename") {
    return { body: "", mtimeMs: 0 };
  }
  try {
    const result = await vfs.read(path);
    return { body: result.content, mtimeMs: result.mtimeMs };
  } catch {
    return { body: "(missing)", mtimeMs: 0 };
  }
}
