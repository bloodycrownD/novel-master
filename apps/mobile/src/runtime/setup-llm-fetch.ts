/**
 * LLM 传输装配（runtime 初始化链调用，须早于首个 LLM 请求）。
 *
 * - 流式：注册 native SSE transport（`registerNativeSseTransportWith` 依赖
 *   注入 core 的 `registerSseTransport`；native 缺位返回 false 安全跳过，
 *   postSse 择优自动回落 XHR，不炸启动）。
 * - 非流式：注册 fetch shim（llm-sse-native `request` 底座）——生产/开发
 *   统一注册，获得整调用 callTimeout 与 native 连接池（spec
 *   llm-stream-native §4）；`__DEV__` 下组合顺序写死 **logging 最外层包
 *   shim**（`createLoggingFetch(shim)`——dev 日志覆盖全部非流式流量，包括
 *   走 native 底座的请求；shim 内部零组合逻辑）。生产构建 logging 不参与。
 *
 * @module runtime/setup-llm-fetch
 */

import {
  configureLlmFetch,
  createLoggingFetch,
  registerSseTransport,
} from '@novel-master/core/provider';
import {registerNativeSseTransportWith} from '@novel-master/llm-sse-native/native';
import {createMobileLlmFetch} from '../services/llm-native-fetch-shim';

let configured = false;

/** 每进程注册一次：native SSE transport + 非流式 fetch shim。 */
export function ensureLlmFetchConfigured(): void {
  if (configured) {
    return;
  }
  configured = true;
  registerNativeSseTransportWith(registerSseTransport);
  const shim = createMobileLlmFetch();
  configureLlmFetch(
    typeof __DEV__ !== 'undefined' && __DEV__
      ? createLoggingFetch(shim)
      : shim,
  );
}
