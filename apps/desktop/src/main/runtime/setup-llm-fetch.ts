/**
 * LLM fetch wiring for main process (must run before first chat request).
 *
 * Unpackaged dev enables {@link DebugFetch.createLoggingFetch} automatically; production uses
 * default adapters unless `NM_DEBUG_LLM_FETCH=1`.
 *
 * 镜像注：mobile 同名入口在 apps/mobile/src/runtime/setup-llm-fetch.ts。两端**不**逐字
 * 镜像——本端只在调试开关（NM_DEBUG_LLM_FETCH / isDesktopLlmDebug）下安装 logging
 * fetch；mobile 端固定注册 native SSE transport + mobile fetch shim。平台底座不同，
 * 故保留双端、不收敛到 core。
 */
import { DebugFetch, Registry } from "@novel-master/core/llm-protocol";
import { LogFactory } from "@novel-master/core/log";
import { LlmDebugFlag } from "../log/llm-debug-flag.js";

const log = LogFactory.create("desktop.llm-fetch");
let configured = false;

// nm-style 注记：文件名 setup- 动词前缀，按内容主体起名（LlmFetchSetup，镜像 mobile 同名文件）。
export namespace LlmFetchSetup {
  /** Registers logging fetch for protocol adapters once per main process. */
  export function ensureConfigured(): void {
    if (configured) {
      return;
    }
    const debugLlm = process.env.NM_DEBUG_LLM_FETCH === "1" || LlmDebugFlag.is();
    if (debugLlm) {
      (globalThis as { __NM_DEBUG_LLM_FETCH__?: boolean }).__NM_DEBUG_LLM_FETCH__ = true;
      Registry.configureLlmFetch(DebugFetch.createLoggingFetch(globalThis.fetch));
      log.info("LLM fetch debug enabled", {
        nmDebugLlmFetch: process.env.NM_DEBUG_LLM_FETCH === "1",
        nmDebugDesktop: process.env.NM_DEBUG_DESKTOP === "1",
      });
    }
    configured = true;
  }
}
