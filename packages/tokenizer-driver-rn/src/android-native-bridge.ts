/**
 * Types and helpers for Android {@code NovelMasterTokenizer} native module (M1).
 *
 * 取消链路（tokenizer-native-cancel）：本文件是 JS 侧取消能力的唯一宿主——
 * in-flight 登记表、`cancelSessionNativeCounts`、`PromptCountCancelledError`
 * 全部定义于此，service / 测试从 `@novel-master/tokenizer-driver-rn/android-native-bridge`
 * 子路径导入（不拖整个驱动 + js-tiktoken 进模块图）。
 */
import { NativeModules, Platform } from "react-native";

export type NativeCountRequest = {
  serialized: string;
  family: string;
  /**
   * `vendorModelId` 槽**双语义**（token-count-perf-r2）：WEB/SP 家族传真实
   * vendor id（仅诊断信息）；`family === "tiktoken"` 时承载 JS 侧已解析的
   * **编码名**（`cl100k_base` / `o200k_base`），Kotlin
   * `TokenizerModule.encodingNameFor` 据此选词表——传其它值会让 Engine 抛
   * 异常、桥 catch 后落回 js 档。
   */
  vendorModelId: string;
  /**
   * 会话归属（由驱动层从 core params 透传）。与 `requestId` 同时在场时，
   * 桥内走可取消的新方法并登记 in-flight；否则走既有三参 `countPrompt`。
   */
  sessionId?: string;
  /** 驱动层生成的请求号（`${sessionId}:${seq}`），同时是 Kotlin 侧取消标记表的键。 */
  requestId?: string;
};

export type NativeCountResponse = {
  tokenCount: number;
  counterKind: string;
  estimated: boolean;
};

type NovelMasterTokenizerNative = {
  countPrompt: (
    serialized: string,
    family: string,
    vendorModelId: string,
  ) => Promise<NativeCountResponse>;
  /**
   * 可取消计数（Step 1 新增的独立方法，既有 `countPrompt` 签名逐字节不动——
   * RN 0.85 双路径对方法 arity 硬校验，加参会让新旧混态双向硬抛）。
   */
  countPromptCancelable: (
    serialized: string,
    family: string,
    vendorModelId: string,
    requestId: string,
  ) => Promise<NativeCountResponse>;
  /** 下发取消标记，fire-and-forget 无 Promise。 */
  cancelCount: (requestId: string) => void;
};

// 可选链是 Jest 工厂防御：部分测试 mock('react-native') 只给 Platform 不给
// NativeModules，本模块又被 chat-prompt-tokens.service 静态 import——顶层直读
// 会让这些套件 require 期整炸（merge 后小 CR P1）。真实运行时 NativeModules
// 恒在，可选链不改变其行为。
const nativeModule = NativeModules?.NovelMasterTokenizer as
  | NovelMasterTokenizerNative
  | undefined;

/** Kotlin 侧取消 reject 的专属 code（区别于 `TOKENIZER_COUNT_FAILED`）。 */
const NATIVE_CANCELLED_CODE = "TOKENIZER_COUNT_CANCELLED";
/**
 * message 前缀兜底。bridgeless 下 `promise.reject(code, message)` 产出的 JS
 * Error 带 `code` 字段（可达）；但 reject 载荷形态随 RN 版本 / 封装层会有差异，
 * 所以再判一次 message 前缀做防御——以真机 reject 形态为准，两条判据任一命中即认取消。
 */
const NATIVE_CANCELLED_MESSAGE_PREFIX = "TOKENIZER_COUNT_CANCELLED";

/**
 * 取消错误：与真实计数失败（落 catch→null → JS 兜底重算）严格区分。
 * 取消**不得**落兜底（那等于先占原生队列再烧 JS 线程），所以桥内识别后上抛。
 */
export class PromptCountCancelledError extends Error {
  constructor(message = "native tokenizer count cancelled") {
    super(message);
    this.name = "PromptCountCancelledError";
  }
}

/**
 * in-flight 登记表（结构按 spec r4-P1 钉死）：
 * 主表按 requestId 登记，次级索引按 sessionId 聚合。
 * 同会话双轮并发（chip 精确轮 + 压缩预热轮）各自登记互不覆盖，
 * 取消按 sessionId 全量命中、注销按 requestId 精确删除（不误删同会话另一轮）。
 */
const inFlightCounts = new Map<string, { sessionId: string }>();
const inFlightCountsBySession = new Map<string, Set<string>>();

function registerInFlightCount(requestId: string, sessionId: string): void {
  inFlightCounts.set(requestId, { sessionId });
  let sessionSet = inFlightCountsBySession.get(sessionId);
  if (sessionSet == null) {
    sessionSet = new Set<string>();
    inFlightCountsBySession.set(sessionId, sessionSet);
  }
  sessionSet.add(requestId);
}

function unregisterInFlightCount(requestId: string): void {
  const entry = inFlightCounts.get(requestId);
  if (entry == null) {
    return;
  }
  inFlightCounts.delete(requestId);
  const sessionSet = inFlightCountsBySession.get(entry.sessionId);
  if (sessionSet == null) {
    return;
  }
  sessionSet.delete(requestId);
  if (sessionSet.size === 0) {
    inFlightCountsBySession.delete(entry.sessionId);
  }
}

/** True when the Android native tokenizer module is linked. */
export function isNativeTokenizerAvailable(): boolean {
  return (
    Platform.OS === "android" &&
    typeof nativeModule?.countPrompt === "function"
  );
}

/**
 * 独立探测可取消计数方法（新 JS + 旧 APK 时为 false → 走既有三参 = 现状）。
 *
 * 逐方法访问、刻意**不并入** `isNativeTokenizerAvailable`：并入会让旧 APK 整体退
 * heuristic 兜底，计数精度从家族精确掉 cl100k 近似——取消是优化项，不是可用性前提。
 * 同时禁止 spread 组装（bridgeless 下 NativeModules 不可枚举展开）。
 */
export function countPromptCancelableAvailable(): boolean {
  return (
    Platform.OS === "android" &&
    typeof nativeModule?.countPromptCancelable === "function"
  );
}

/** 独立探测取消指令下发方法（同上口径，旧壳缺失即 no-op 不抛）。 */
export function cancelCountAvailable(): boolean {
  return (
    Platform.OS === "android" &&
    typeof nativeModule?.cancelCount === "function"
  );
}

function isNativeCancelledError(error: unknown): boolean {
  if (typeof error !== "object" || error == null) {
    return (
      typeof error === "string" &&
      error.startsWith(NATIVE_CANCELLED_MESSAGE_PREFIX)
    );
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code === NATIVE_CANCELLED_CODE) {
    return true;
  }
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    message.startsWith(NATIVE_CANCELLED_MESSAGE_PREFIX)
  );
}

/**
 * Count tokens via Kotlin bridge. Returns null when native is unavailable (iOS / tests).
 *
 * 二分口径：sessionId 与 requestId 均在场且原生侧可取消方法存在 → 四参新方法
 * （并在过桥调用**前**登记 in-flight）；否则走既有三参 `countPrompt`（= 现状，不可取消）。
 */
export async function countPromptViaNative(
  request: NativeCountRequest,
): Promise<NativeCountResponse | null> {
  if (!isNativeTokenizerAvailable() || nativeModule == null) {
    return null;
  }
  const sessionId = request.sessionId;
  const requestId = request.requestId;
  if (
    sessionId != null &&
    requestId != null &&
    countPromptCancelableAvailable()
  ) {
    // 登记点=过桥调用前：注销点在 finally（Kotlin 侧 cancelCount 之后才到达）
    registerInFlightCount(requestId, sessionId);
    try {
      return await nativeModule.countPromptCancelable(
        request.serialized,
        request.family,
        request.vendorModelId,
        requestId,
      );
    } catch (error) {
      if (isNativeCancelledError(error)) {
        throw new PromptCountCancelledError();
      }
      return null;
    } finally {
      unregisterInFlightCount(requestId);
    }
  }
  try {
    return await nativeModule.countPrompt(
      request.serialized,
      request.family,
      request.vendorModelId,
    );
  } catch (error) {
    if (isNativeCancelledError(error)) {
      throw new PromptCountCancelledError();
    }
    return null;
  }
}

/**
 * 按会话下发取消指令：遍历次级索引逐个 `cancelCount(requestId)`。
 *
 * 只发指令、**不动登记表**——在途轮的生命周期一律由各自 `finally` 精确注销，
 * 外部清理踩掉 finally 会楔死估算档（本函数绝不碰表）。
 * sessionId 为 null/undefined、取消方法缺失、无在途记录时均为 no-op 不抛。
 */
export function cancelSessionNativeCounts(
  sessionId: string | null | undefined,
): void {
  if (sessionId == null) {
    return;
  }
  if (!cancelCountAvailable() || nativeModule == null) {
    return;
  }
  const requestIds = inFlightCountsBySession.get(sessionId);
  if (requestIds == null) {
    return;
  }
  for (const requestId of requestIds) {
    try {
      nativeModule.cancelCount(requestId);
    } catch {
      // fire-and-forget：单条下发失败不阻断同会话其余轮次
    }
  }
}
