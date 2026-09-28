/**
 * desktop renderer 的实时 token 估算器绑定（stream-metrics-native ②）。
 *
 * - 编码表：v1 **固定 cl100k_base**——renderer 是纯 web（sandbox/
 *   contextIsolation），js-tiktoken 纯 JS 可直接用；按会话模型解析
 *   o200k/cl100k 需要读会话/模型仓储（异步、且 renderer 侧暂无 IPC 面），
 *   留给后续迭代。o200k 模型（gpt-4o/o1/o3/gpt-5）用 cl100k 估算的偏差是
 *   有界的既有近似（Chinese 端约 ±10% 量级），且 usage 真值到达即重锚基线，
 *   误差不累积。
 * - 编码表缓存：经 core `encoding-registry` 收口（`@shared/logic/encoding` 再
 *   导出，X1 门禁禁止 renderer 直连 core）——renderer 进程内单键单例（键
 *   `enc:cl100k_base`），与 node/RN 端共用同一段生命周期实现；构造器在本
 *   文件注入（`new Tiktoken(cl100kRanks)`，js-tiktoken/lite，先例即本文件）。
 *   每张编码表构造要解析全量 ranks（实测 cl100k 约 180–250ms、o200k 约
 *   420ms），不能每次 run 重建；构造失败（缺 ranks / 环境异常）由 registry
 *   缓存 null（TTL 5 分钟后允许重试），调用方回退启发式。
 *
 * @module renderer/hooks/stream-token-estimator
 */
import {
  createIncrementalTokenCounter,
  type IncrementalTokenCounter,
} from "@shared/logic/format";
import { getEncoding, type EncodingHandle } from "@shared/logic/encoding";
import { Tiktoken } from "js-tiktoken/lite";
import cl100kRanks from "js-tiktoken/ranks/cl100k_base";

/**
 * cl100k_base 编码表取用口：registry 单键单例，构造器只在缓存 miss 时被
 * 调一次；失败缓存 null（try/catch 与告警在 registry 内部，TTL 5 分钟后
 * 允许重试）。返回共享句柄，不得 `free()`。
 */
function getCl100kEncoding(): EncodingHandle | null {
  return getEncoding("cl100k_base", () => new Tiktoken(cl100kRanks));
}

/**
 * 建一条实时 token 估算器（尾窗增量计数）；编码表不可用时返回 null，
 * 调用方（`useAgentStreamMetrics`）回退启发式。
 */
export function createDesktopStreamTokenEstimator(): IncrementalTokenCounter | null {
  const encoding = getCl100kEncoding();
  if (encoding == null) {
    return null;
  }
  return createIncrementalTokenCounter({
    encode: text => encoding.encode(text).length,
  });
}
