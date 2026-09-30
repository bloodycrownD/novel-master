/**
 * session kkv file_cache：命中则返回；否则按档位读 VFS 并回写。
 * assemble 常驻前缀与 prepare hydrate 共用，避免双份平行实现。
 *
 * 读取侧降级（huge-card-import-crash）：cache miss 后先轻量探测 content
 * 大小（`vfs.findContentSize`，不读正文），超过单文件闸门的文件不进全文
 * 读取、不写 file_cache，直接返回占位内容——保证误导入巨型角色卡的存量
 * 用户重启后 workplace 前缀组装不会整读毒数据触发原生 OOM（崩溃循环）。
 *
 * 写回时序（2026-09-30 workplace 冷路径优化）：`fillFileCacheFromVfs` 的
 * `deferBackfillWrite` 把「压缩 + 落库」移出组装关键路径。file_cache 是
 * 加速层，读侧要的正文已经拿到，后台写只是让下次组装变快；写失败静默，
 * 下次重新回填。
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
  return fillFileCacheFromVfs(deps);
}

/** {@link fillFileCacheFromVfs} 的行为开关。 */
export interface FillFileCacheOptions {
  /**
   * `true` 时把「序列化 + 哈希 + 压缩 + 写回 file_cache」整段改成
   * fire-and-forget 后台任务（推迟一个宏任务，见 {@link scheduleBackfill}
   * 里 JS 线程争抢的说明）：读到的内容立刻返回给组装路径，写回不再
   * 挡在读者面前。
   *
   * 量化依据（2026-09-30 探针，3 文件合计 6M 字符 / 真实 sqlite + 真实
   * VFS / Node 22）：改前冷态 assemble 466ms（纯读 108ms，回填写侧占
   * 77%），改后 128ms。写侧里 hash 127ms + deflate 173ms 是大头
   * （Hermes 上纯 JS deflate 更贵），而缓存只是加速层——读侧要的正文
   * 已经在手里了。
   *
   * 缺省 `false`（同步写回）：hydrate 等需要「返回即已落库」的调用方
   * 保持原语义。
   */
  readonly deferBackfillWrite?: boolean;
}

/**
 * 在途后台回填集合（fire-and-forget 的可观测把手）。
 *
 * 只服务两件事：测试断言「缓存最终被回填」，以及给未来需要确定性的调用
 * 方一个落定闸门。生产组装路径不 await 它。
 */
const pendingBackfills = new Set<Promise<void>>();

/**
 * 等待当前所有后台回填落定。
 *
 * @remarks 仅测试与显式需要确定性的调用方使用；循环取快照是因为回填
 * 落定前的清理回调才把条目移出集合，单次 `Promise.all` 会漏掉尾批。
 */
export async function settlePendingFileCacheBackfills(): Promise<void> {
  while (pendingBackfills.size > 0) {
    await Promise.all([...pendingBackfills]);
  }
}

/**
 * 登记一个后台回填：rejection 静默吞掉，不留 unhandled。
 *
 * 为什么要推迟到宏任务（`setTimeout(0)`）而不是直接 `void write()`：
 * `fflate` 的 `zlibSync` 是**同步 CPU** 工作，fire-and-forget 只是不 await
 * 它，它照样占着同一条 JS 线程。冷态下 assemble 的 for 循环还在逐个
 * `await vfs.read`，压缩插在中间会把后面的读全拖慢——实测（3 文件 6M 字符
 * / Node 22，同一台机器）直接 `void write()` 是 375ms，推迟到宏任务后
 * 128ms，逼近纯读的 108ms。推迟一个宏任务让本轮读链先跑完，正文先交到
 * 读者手里，压缩随后在后台把缓存填上。
 *
 * file_cache 是纯加速层，写失败（连接关、域被并发清掉、blob 表写不进去）
 * 的正确后果就是「下次组装重新回填」，不该把错误冒泡到宿主。
 */
function scheduleBackfill(write: () => Promise<void>): void {
  const settled = new Promise<void>((resolve) => {
    setTimeout(() => {
      void write().then(
        () => resolve(),
        () => resolve()
      );
    }, 0);
  });
  pendingBackfills.add(settled);
  void settled.then(() => {
    pendingBackfills.delete(settled);
  });
}

/**
 * 缓存 miss 后的回填半段（loadOrFill 与 assemble 批量预取共用）：
 * 超限探测 → VFS 读取 → 写回 file_cache。
 *
 * @param options `deferBackfillWrite: true` 时写回后台化（见
 *   {@link FillFileCacheOptions}）；返回值始终是读到的内容，与写回无关。
 */
export async function fillFileCacheFromVfs(
  deps: LoadOrFillFileCacheDeps,
  options?: FillFileCacheOptions
): Promise<FileCachePayload> {
  const key = fileCacheKey(deps.status, deps.path);

  if (deps.status !== "filename") {
    const placeholder = await probeOversizePlaceholder(deps.vfs, deps.path);
    if (placeholder != null) {
      // 超大文件降级：不读全文、不写 file_cache（避免把占位符粘进缓存）；
      // 每次组装重新轻量探测，代价只是一条长度 SQL；mtime 用探测带回的
      // 真实值，避免占位块渲染出 1970 假时间戳随提示词送给模型
      return placeholder;
    }
  }

  const filled = await readWorkplaceFileBody(deps.path, deps.status, deps.vfs);
  const writeBack = (): Promise<void> =>
    deps.sessionKkv.set(
      deps.sessionId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload(filled)
    );
  if (options?.deferBackfillWrite === true) {
    scheduleBackfill(writeBack);
  } else {
    await writeBack();
  }
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
): Promise<FileCachePayload | null> {
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
      return {
        body: `（文件过大，已跳过，约 ${size.size} 字符）`,
        mtimeMs: size.mtimeMs,
      };
    }
    return null;
  }
  if (size.size > CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES) {
    // 压缩侧长度按 4× 折算为明文字符数的估计值（标注「约」）
    return {
      body: `（文件过大，已跳过，约 ${size.size * 4} 字符）`,
      mtimeMs: size.mtimeMs,
    };
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
