/**
 * session kkv file_cache：命中则返回；否则按档位读 VFS 并回写。
 * assemble 常驻前缀与 prepare hydrate 共用，避免双份平行实现。
 *
 * 读取侧降级（huge-card-import-crash）：cache miss 后先轻量探测 content
 * 大小（`vfs.findContentSize`，不读正文），超过单文件闸门的文件不进全文
 * 读取、不写 file_cache，直接返回占位内容——保证误导入巨型角色卡的存量
 * 用户重启后 workplace 前缀组装不会整读毒数据触发原生 OOM（崩溃循环）。
 */

import {
  fileCacheKey,
  SESSION_KKV_DOMAIN_FILE_CACHE,
  type WorkplaceDisplayStatus,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import {
  CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES,
  CHARACTER_CARD_MAX_SINGLE_FILE_BYTES,
} from "@/domain/character-card/logic/character-card-limits.js";
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
  deps: LoadOrFillFileCacheDeps
): Promise<FileCachePayload> {
  const key = fileCacheKey(deps.status, deps.path);
  const raw = await deps.sessionKkv.get(
    deps.sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
    key
  );
  if (raw != null) {
    const parsed = parseFileCachePayload(raw);
    if (parsed != null) {
      return parsed;
    }
  }

  if (deps.status !== "filename") {
    const placeholder = await probeOversizePlaceholder(deps.vfs, deps.path);
    if (placeholder != null) {
      // 超大文件降级：不读全文、不写 file_cache（避免把占位符粘进缓存）；
      // 每次组装重新轻量探测，代价只是一条长度 SQL
      return { body: placeholder, mtimeMs: 0 };
    }
  }

  const filled = await readWorkplaceFileBody(deps.path, deps.status, deps.vfs);
  await deps.sessionKkv.set(
    deps.sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
    key,
    serializeFileCachePayload(filled)
  );
  return filled;
}

/**
 * 轻量探测文件大小，超限返回占位文本；否则返回 null 走原读取路径。
 *
 * - 内联行：字符数直接对比单文件上限（近似闸门，字符数 ≥ 字节数场景已足够）
 * - content store 行：只有压缩侧长度（明文下界），按 4× 压缩比折算到压缩闸门，
 *   方向保守——宁可多占位（应用存活）也不放行会在解压/渲染链上 OOM 的文件
 * - 查询失败 / 不支持 / 无法探测（null）→ 保守回退原 vfs.read 行为
 */
async function probeOversizePlaceholder(
  vfs: VfsService,
  path: string
): Promise<string | null> {
  let size;
  try {
    size = await vfs.findContentSize(path);
  } catch {
    // 查询失败按可读处理：走原路径（不阻断组装）
    return null;
  }
  if (size == null) {
    return null;
  }
  if (size.kind === "inlineChars") {
    if (size.size > CHARACTER_CARD_MAX_SINGLE_FILE_BYTES) {
      return `（文件过大，已跳过，约 ${size.size} 字符）`;
    }
    return null;
  }
  if (size.size > CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES) {
    // 压缩侧长度按 4× 折算为明文字符数的估计值（标注「约」）
    return `（文件过大，已跳过，约 ${size.size * 4} 字符）`;
  }
  return null;
}

async function readWorkplaceFileBody(
  path: string,
  status: WorkplaceDisplayStatus,
  vfs: VfsService
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
