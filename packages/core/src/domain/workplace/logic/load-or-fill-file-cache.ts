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

/**
 * filename 不读盘；缺失用 `(missing)` 占位。
 *
 * ⚠️ 占位 payload **不写 file_cache**（降级来源一律不落库，见 {@link FillResult.degraded}）：
 * `file_cache` 命中无条件返回、**无 mtime 校验**，改写它的只有改规则 / 手动压缩 /
 * 置位 / 会话删除（自动压缩不清，见 run-compaction 头注释）⇒ 一次偶发读失败就会
 * 让该 path 在本会话余下所有轮次都渲染成 `(missing)`，且再也不会自愈。
 * 这与同域「超大文件占位符不写 cache」的既有决策自相矛盾。
 *
 * filename 档会做一次轻量 meta 探测（`vfs.findContentSize`，不读正文）拿真实
 * `mtimeMs`，避免组装时把 `1970-01-01` 假时间戳写进常驻提示词。
 */
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
 * 本模块私有的回填结果。
 *
 * ⚠️ `degraded` **不得**加宽共享的 `FileCachePayload`：后者在 `rule-snapshot-codec.ts`
 * 里被组装与序列化/解析共用，一旦加进去 `degraded` 就会进入
 * `serializeFileCachePayload` 的写入面、留下持久类型污染。它只在
 * {@link fillFileCacheFromVfs} 内部用于判降级；**返回给调用方的仍是
 * `FileCachePayload`**（不外泄 `degraded`）。
 */
type FillResult = {
  readonly payload: FileCachePayload;
  /** true = 该 payload 来自降级兜底（`(missing)` / 探测失败），**不得**写入 file_cache。 */
  readonly degraded?: boolean;
};

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

  // 轻量 meta 探测提到 status 判断之外：filename 档也需要它拿真实 mtimeMs
  // （否则组装时渲染出 1970 假时间戳）。探测失败 / null 一律保守放行原路径。
  const probe = await probeFileMeta(deps.vfs, deps.path);

  // ⚠️ 超限占位分支**只对非 filename 档生效**（既有语义不变）：filename 档渲染的是
  // 文件名本身、payload.body 恒为空串，占位正文对它没有意义。
  if (deps.status !== "filename" && probe.placeholder != null) {
    // 超大文件降级：不读全文、不写 file_cache（避免把占位符粘进缓存）；
    // 每次组装重新轻量探测，代价只是一条长度 SQL；mtime 用探测带回的
    // 真实值，避免占位块渲染出 1970 假时间戳随提示词送给模型
    return probe.placeholder;
  }

  const filled = await readWorkplaceFileBody(
    deps.path,
    deps.status,
    deps.vfs,
    probe.mtimeMs
  );
  // 降级来源不落 cache（判据用显式标记，**不是**正文匹配——`(missing)`
  // 三个字可能真出现在文件正文里）。
  if (filled.degraded === true) {
    return filled.payload;
  }
  const writeBack = (): Promise<void> =>
    deps.sessionKkv.set(
      deps.sessionId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      key,
      serializeFileCachePayload(filled.payload)
    );
  if (options?.deferBackfillWrite === true) {
    scheduleBackfill(writeBack);
  } else {
    await writeBack();
  }
  return filled.payload;
}

/**
 * 轻量探测文件大小（不读正文）。
 *
 * - `placeholder != null`：超限占位（连同探测带回的真实 `mtimeMs`），调用方直接返回
 * - `placeholder == null`：未超限，`mtimeMs` 是可直接采用的真实值（探测不可用时为 `undefined`）
 */
type FileMetaProbe = {
  readonly placeholder: FileCachePayload | null;
  readonly mtimeMs: number | undefined;
};

async function probeFileMeta(
  vfs: VfsService,
  path: string
): Promise<FileMetaProbe> {
  let size;
  try {
    size = await vfs.findContentSize(path);
  } catch {
    // 查询失败按可读处理：走原路径（不阻断组装）
    return { placeholder: null, mtimeMs: undefined };
  }
  if (size == null) {
    return { placeholder: null, mtimeMs: undefined };
  }
  if (size.kind === "inlineChars") {
    if (size.size > CHARACTER_CARD_MAX_SINGLE_FILE_BYTES) {
      return {
        placeholder: {
          body: `（文件过大，已跳过，约 ${size.size} 字符）`,
          mtimeMs: size.mtimeMs,
        },
        mtimeMs: size.mtimeMs,
      };
    }
    return { placeholder: null, mtimeMs: size.mtimeMs };
  }
  if (size.size > CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES) {
    // 压缩侧长度按 4× 折算为明文字符数的估计值（标注「约」）
    return {
      placeholder: {
        body: `（文件过大，已跳过，约 ${size.size * 4} 字符）`,
        mtimeMs: size.mtimeMs,
      },
      mtimeMs: size.mtimeMs,
    };
  }
  return { placeholder: null, mtimeMs: size.mtimeMs };
}

async function readWorkplaceFileBody(
  path: string,
  status: WorkplaceDisplayStatus,
  vfs: VfsService,
  probedMtimeMs: number | undefined
): Promise<FillResult> {
  if (status === "filename") {
    // filename 档不读正文，但仍用探测带回的真实 mtime（探测不可用时退回 0）。
    return { payload: { body: "", mtimeMs: probedMtimeMs ?? 0 } };
  }
  try {
    const result = await vfs.read(path);
    return { payload: { body: result.content, mtimeMs: result.mtimeMs } };
  } catch {
    return { payload: { body: "(missing)", mtimeMs: 0 }, degraded: true };
  }
}
