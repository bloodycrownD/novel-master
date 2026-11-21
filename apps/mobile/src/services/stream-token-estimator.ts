/**
 * mobile 侧实时 token 估算器绑定（stream-metrics-native ②）。
 *
 * 把 `SessionStreamUnit` 的实时 token 估算从 `ceil(chars/3.35)` 启发式升级为
 * 真 BPE 尾窗增量计数（core 的 `IncrementalTokenCounter.create`）：
 * - 用 `js-tiktoken/lite` 的真编码表（mobile 既有依赖，Metro 已重定向
 *   `tiktoken` shim，离线可用、零新增包体）；
 * - **编码表惰性单例 + 按编码名缓存**（stream-metrics-native ④ 起下沉到
 *   `@novel-master/tokenizer-driver-rn/encoding`，与驱动侧的兜底计数共用同一份
 *   表，避免同进程建两份）：构造要解析全量 ranks（实测 cl100k_base 约
 *   180–250ms、o200k_base 约 420ms），不能每次 run 重建；也**不在模块顶层
 *   构造**（RN 依赖 `fast-text-encoding` polyfill 先执行）。构造时机＝**会话
 *   切换时空闲预热**（`primeModelHint` 的 `.then` 回调里
 *   `setTimeout(..., 0)`），未就绪时在 `begin()`（run 起手）同步兜底；
 * - 构造 / encode 失败一律返回 null → 调用方回退启发式；估算器内部对 encode
 *   抛错也已吞掉（保持上一次读值），这里只是把「整张编码表都建不起来」的
 *   情况挡在调用方之前。
 *
 * 编码名解析（best-effort）：sessionId → 会话 agent 配置 modelId（缺省回退
 * agent pin）→ saved model → `vendorModelId` → core 的
 * `TokenizerFamilyResolver.resolve` / `TokenizerFamilyResolver.mapVendorModelIdToTiktokenModel` +
 * js-tiktoken 的 `getEncodingNameForModel` → `o200k_base`（gpt-4o/o1/o3/o4/
 * gpt-4.1/gpt-4.5/gpt-5）否则 `cl100k_base`。
 * - **非 tiktoken 家族（claude/qwen/glm…）本轮也用 cl100k 估算**：这些模型
 *   各有自己的 tokenizer，js-tiktoken 给不出真值，用 cl100k 只是**近似估算**
 *   （`tokenSource` 仍是 `'heuristic'`，联合类型与 DB 列语义不动）；
 * - 读取会话/模型是异步仓储，而单元创建是同步的：解析结果落**会话级提示
 *   缓存**（带 10 分钟 TTL，换模型后不沿用旧编码），装配方在会话切换时
 *   预热（`primeModelHint`），首个 run 起手基本已就绪；没赶上
 *   就按 cl100k 兜底，usage 真值到达后仍会重锚基线。
 *
 * @module services/stream-token-estimator
 */

import {IncrementalTokenCounter, TokenizerFamilyResolver} from '@novel-master/core/tokenizer';

/** core Result 的线上结构（`Result` 本体尚未进 public 面，三期收口时换真类型）。 */
type ResultWire<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly error: unknown};
import {getEncodingNameForModel} from 'js-tiktoken/lite';
// 编码表的**单例缓存下沉到驱动**（stream-metrics-native ④）：本文件原来自己维护
// 一份 `encodingByCacheKey`，而驱动侧的兜底计数（`count-prompt-llm-input`）也
// 要用 cl100k——同进程两份表就是白付两次 185–248ms 的构造。驱动的
// `getRnEncoding` 是惰性构造 + 按名缓存 + 构造失败缓存 null，与本文件原有策略
// 逐条一致，故这里直接复用，语义不变、重复内存消失。
// 走 `./encoding` 子路径而非主入口：主入口会连带拉进 `react-native` 与原生
// bridge，而本服务只是纯逻辑。
import {EncodingCache, type RnEncodingName} from '@novel-master/tokenizer-driver-rn/encoding';

/** 支持的编码名（本模块只区分这两张表）。 */
type StreamTokenEncodingName = RnEncodingName;

/** 会话级 vendor model id 提示缓存（异步解析结果；上限防无界增长）。 */
const VENDOR_MODEL_HINT_CACHE_MAX = 32;
/**
 * 提示条目存活时长：用户可能在会话内换模型（模型选择器改的是会话配置），
 * 过期的提示会让人换模型后继续按旧编码估算、偏差静默发生。过期判定与
 * 淘汰都收在读口一处（见 `createForSession`），prime 不重复判时钟。
 */
const VENDOR_MODEL_HINT_TTL_MS = 10 * 60_000;
const vendorModelHintBySession = new Map<string, {readonly vendorModelId: string | null; readonly atMs: number}>();
/** 在途解析（同会话去重，避免每次 startRun 都打一轮仓储）。 */
const vendorModelHintInFlight = new Set<string>();

/** 编码表按编码名缓存（惰性单例 + 构造失败缓存 null）已下沉到 RN 驱动
 * （`getRnEncoding`），本文件不再自持一份 map——否则同进程会建两份表。 */

/** 会话/模型仓储窄口（估算器只消费这一小撮读取方法）。 */
export interface StreamTokenModelHintRuntime {
  readonly sessions: {
    // ResultWire：core 的 Result 线上结构（`Result` 本体尚未进 public 面，三期收口）。
    getSessionAgentConfig(id: string): Promise<ResultWire<{agentId: string; modelId?: string | undefined}>>;
  };
  readonly agentRegistry: {
    // 五期门⑦：registry 读口已知失败走 Result（结构同 ResultWire）。
    get(agentId: string): Promise<ResultWire<{model?: string | undefined}>>;
  };
  readonly providerModels: {
    // 五期门⑦：getSavedById 已知失败走 Result（结构同 ResultWire）。
    getSavedById(id: string): Promise<ResultWire<{vendorModelId: string} | null>>;
  };
}

export namespace StreamTokenEstimator {
  /** 模型名 → 编码名（只区分 o200k/cl100k；try/catch 兜底未知模型抛错）。 */
  function encodingForModel(model: string): StreamTokenEncodingName | null {
    try {
      // getEncodingNameForModel 的入参类型是字面量模型名联合，vendor 侧是任意
      // 字符串（未知模型会抛错）——按 unknown 传入、异常兜底。
      return getEncodingNameForModel(model as never) === 'o200k_base' ? 'o200k_base' : 'cl100k_base';
    } catch {
      return null;
    }
  }

  /**
   * vendorModelId → 编码名（best-effort，解析不出/非 tiktoken 家族落 cl100k）。
   *
   * 顺序：先直接问 js-tiktoken（能命中 `gpt-4o` / `gpt-5` 这类标准 id 及其
   * 快照名），再按 core 的家族表走 vendor 前缀映射（`openai/gpt-4o`、
   * `gpt-4.1-mini` 等子串形态）。两次都问不出 → cl100k。
   */
  export function resolveEncodingName(vendorModelId: string | null | undefined): StreamTokenEncodingName {
    const id = (vendorModelId ?? '').trim();
    if (id.length === 0) {
      return 'cl100k_base';
    }
    const direct = encodingForModel(id);
    if (direct != null) {
      return direct;
    }
    if (TokenizerFamilyResolver.resolve(id, 'auto') === 'tiktoken') {
      const mapped = encodingForModel(TokenizerFamilyResolver.mapVendorModelIdToTiktokenModel(id));
      if (mapped != null) {
        return mapped;
      }
    }
    return 'cl100k_base';
  }

  /**
   * 建一条实时 token 估算器（尾窗增量计数）；编码表不可用时返回 null，
   * 调用方（SessionStreamUnit）回退启发式。
   */
  // nm-style: keep-public — stream-token-estimator.test.ts 直接 import 多用例断言（null 回退/计数口径），测试锁名
  export function create(options?: {readonly vendorModelId?: string | null | undefined}): IncrementalTokenCounter | null {
    const encodingName = resolveEncodingName(options?.vendorModelId ?? null);
    const encoding = EncodingCache.get(encodingName);
    if (encoding == null) {
      return null;
    }
    return IncrementalTokenCounter.create({
      encode: text => encoding.encode(text).length,
    });
  }

  /** 解析会话的 vendor model id（失败/缺配置 → null，不抛）。 */
  // nm-style: keep-public — stream-token-estimator.test.ts 直接 import 断言，测试锁名
  export async function resolveVendorModelId(runtime: StreamTokenModelHintRuntime, sessionId: string): Promise<string | null> {
    try {
      const sessionConfig = await runtime.sessions.getSessionAgentConfig(sessionId);
      // 失败 → null（错误通道迁移四期：与旧 catch 同款兜底，不抛）。
      if (!sessionConfig.ok) {
        return null;
      }
      let savedModelId = sessionConfig.value.modelId;
      if (savedModelId == null || savedModelId.length === 0) {
        const definition = await runtime.agentRegistry.get(sessionConfig.value.agentId);
        // registry 读失败（已知失败）与旧 catch 同款兜底：回落 modelId 缺省路径。
        savedModelId = definition.ok ? definition.value.model : undefined;
      }
      if (savedModelId == null || savedModelId.length === 0) {
        return null;
      }
      const saved = await runtime.providerModels.getSavedById(savedModelId);
      // 读失败（已知失败）与旧 catch 同款兜底：null 缺省路径（错误通道迁移四期，
      // 同上方 sessionConfig / definition 两处口径，不解包上抛）。
      if (!saved.ok) return null;
      const vendorModelId = saved.value?.vendorModelId;
      return vendorModelId != null && vendorModelId.length > 0 ? vendorModelId : null;
    } catch {
      return null;
    }
  }

  /**
   * 预热会话的 vendor model id 提示（装配方在会话切换时调用；幂等、在途去重）。
   * 结果落会话级缓存，供该会话的 run 创建估算器时同步取用；解析落地后顺带
   * 空闲预热两张编码表（见 `.then` 回调内注释）。
   */
  export function primeModelHint(runtime: StreamTokenModelHintRuntime, sessionId: string): void {
    if (vendorModelHintBySession.has(sessionId) || vendorModelHintInFlight.has(sessionId)) {
      return;
    }
    vendorModelHintInFlight.add(sessionId);
    void resolveVendorModelId(runtime, sessionId)
      .then(vendorModelId => {
        if (vendorModelHintBySession.size >= VENDOR_MODEL_HINT_CACHE_MAX) {
          // 简单 FIFO 淘汰：提示只是「首轮少猜一次编码」，丢旧无害。
          const oldest = vendorModelHintBySession.keys().next().value;
          if (oldest != null) {
            vendorModelHintBySession.delete(oldest);
          }
        }
        vendorModelHintBySession.set(sessionId, {
          vendorModelId,
          atMs: Date.now(),
        });
        // 空闲预热编码表：把 180–420ms 的构造从「点发送」搬到「切会话之后的
        // 下一个宏任务」，`begin()` 那边多半已是命中缓存。**两张都要热**——
        // 解析出的那张给赶上了提示的首 run，`cl100k_base` 兜底那张给「提示
        // 没赶上」的首 run（此时 `begin()` 会按 cl100k 起算并同步构造，不热就
        // 白付一次）。`setTimeout(..., 0)` 只是挪到下一个宏任务，不等于不卡。
        setTimeout(() => {
          EncodingCache.get(resolveEncodingName(vendorModelId));
          EncodingCache.get('cl100k_base');
        }, 0);
      })
      .catch(() => undefined)
      .finally(() => {
        vendorModelHintInFlight.delete(sessionId);
      });
  }

  /**
   * 为某会话建实时 token 估算器（`SessionStreamUnit` 的
   * `tokenEstimatorFactory` 落点）：用会话级提示缓存里的 vendorModelId 选编码，
   * 缓存未就绪/已过期时按 cl100k 兜底（并在后台重新预热，供后续 run 使用）。
   *
   * 说明：编码在估算器创建时**一次定死**，run 中途不切换（换编码会让累计值
   * 跳变、污染速率窗口）；要换编码只能等下一个 run。
   */
  // nm-style: keep-public — stream-token-estimator.test.ts 直接 import 断言 hint 缓存/TTL 语义，测试锁名
  export function createForSession(runtime: StreamTokenModelHintRuntime, sessionId: string): IncrementalTokenCounter | null {
    // 读会话级 vendor model id（命中即返；未解析或已过期返回 undefined）。
    // **过期即淘汰**：判定过期时直接 `delete`，让 prime 的 `has` 早退守卫放行、
    // 重新解析一次；条目留在 map 里会让 prime 被 `has()` 挡死、该会话此后永久
    // 退回 cl100k（直到被 32 上限 FIFO 偶然淘汰）——TTL 就成了摆设。
    const hintEntry = vendorModelHintBySession.get(sessionId);
    let hint: string | null | undefined = undefined;
    if (hintEntry !== undefined) {
      if (Date.now() - hintEntry.atMs > VENDOR_MODEL_HINT_TTL_MS) {
        vendorModelHintBySession.delete(sessionId);
      } else {
        hint = hintEntry.vendorModelId;
      }
    }
    if (hint === undefined) {
      // 首轮没赶上预热：按 cl100k 起算，同时踢一次解析（下一轮 run 用得上）。
      primeModelHint(runtime, sessionId);
    }
    return create({vendorModelId: hint ?? null});
  }
}
