/**
 * IPC error formatting — maps Core domain errors to serializable payloads.
 * `code` 的取值空间是 core 码表 key（ErrorKey）；分派链 10 条顺序硬写
 * （VFS_* → PROVIDER_* → CLOUD_SYNC_* → 通配），写反会让某个前缀分支不可达。
 *
 * @module ipc/format-ipc-error
 */
import type { IpcErrorPayload } from "../../../shared/ipc-types.js";
import { isAbortLikeError } from "@novel-master/core/abort";
import { AgentTurnError } from "@novel-master/core/agent";
import { isAppError } from "@novel-master/core/agent";
import { domainOf } from "@novel-master/core/errors";
import { userMessageOf } from "@novel-master/core/i18n";
import { coreT } from "../../../shared/logic/core-i18n.js";
import { ZodError } from "zod";

/**
 * 错误 → 用户可见中文文案：i18n 后 AppError 在 descriptor 模式下 `message`
 * 是英文 desc，中文在 messageKey/catalog 里；IPC 边界统一解析，renderer 拿到
 * 的 message 直接可显示。未覆盖的错误回退原 message。
 */
function visibleMessage(err: unknown, fallback: string): string {
  const descriptor = userMessageOf(err);
  return descriptor != null ? coreT(descriptor) : fallback;
}

const FIELD_LABELS: Record<string, string> = {
  endDepth: "结束深度",
  startDepth: "起始深度",
  pattern: "正则表达式",
  name: "名称",
};

/**
 * Maps a thrown value to an {@link IpcErrorPayload} for IPC responses.
 * `code` 只产 ErrorKey；未知错误统一 INFRA_UNEXPECTED_ERROR（name 不进 code）。
 */
export function formatIpcError(err: unknown): IpcErrorPayload {
  // 0. AbortError：取消是控制流信号不是业务错误（signal-abort-scope §五）。
  //    边界统一映射为 IPC_ABORTED，renderer 按 code 静默收尾、不弹错误 toast。
  //    必须排在 AppError 通配之前：AbortError 是 Error 子类（DOMException 或
  //    RN 的 Error + name），落到第 9 条会被兜成 INFRA_UNEXPECTED_ERROR。
  if (isAbortLikeError(err)) {
    return { code: "IPC_ABORTED", message: "已取消" };
  }
  // 1. ZodError：参数校验（desktop 独有入口；镜像门对本条豁免）。
  if (err instanceof ZodError) {
    const parts = err.issues.map((issue) => {
      const pathKey = issue.path.map(String).join(".");
      const label = FIELD_LABELS[pathKey] ?? pathKey;
      const msg = issue.message;
      if (msg.includes("expected number") && msg.includes("null")) {
        return label ? `${label}须为非负整数或留空` : "须为非负整数或留空";
      }
      return label ? `${label}：${msg}` : msg;
    });
    return { code: "INFRA_VALIDATION_FAILED", message: parts.filter(Boolean).join("；") || err.message };
  }
  // 2. VFS_*：AppError 且 code 落 VFS 域段（102 VFS + 103 VFS_CHARACTER_CARD），
  //    域判定走 domainOf（spec-3 §3.7），不依赖 key 命名约定。core service 已直抛
  //    AppError（三期 Step 6 删 legacy mapper），不设历史对象兜底。
  if (isAppError(err) && (domainOf(err.code) === "VFS" || domainOf(err.code) === "VFS_CHARACTER_CARD")) {
    return { code: err.key, message: visibleMessage(err, err.message) };
  }
  // 3. PROVIDER_*：文案走码表 messageKey。
  if (isAppError(err) && domainOf(err.code) === "PROVIDER") {
    return { code: err.key, message: visibleMessage(err, err.message) };
  }
  // 4. CLOUD_SYNC_*：文案走码表 messageKey / 构造点 descriptor。
  if (isAppError(err) && domainOf(err.code) === "CLOUD_SYNC") {
    return { code: err.key, message: visibleMessage(err, err.message) };
  }
  // 5. 旧 ToolError 的 VFS cause 解包（类已退役，等价判 TOOL_FAILED；cause 双写在
  //    Error.cause 与 details.cause，一期 spec §2.5 保留）。VFS cause 透传 VFS_ 前缀
  //    key，renderer PreviewPane 按 VFS_NOT_FOUND 分支命中。
  if (isAppError(err, "TOOL_FAILED")) {
    const cause = err.cause ?? (err.details as { cause?: unknown } | undefined)?.cause;
    if (isAppError(cause) && (domainOf(cause.code) === "VFS" || domainOf(cause.code) === "VFS_CHARACTER_CARD")) {
      return { code: cause.key, message: visibleMessage(cause, cause.message) };
    }
    const fallback = cause instanceof Error ? cause.message : err.message;
    return { code: err.key, message: visibleMessage(err, fallback) };
  }
  // 6. 其余 AppError 通配（SESSION_FS_* 的 missingLogicalPaths 在此透传）。
  if (isAppError(err)) {
    const details = (err as { details?: unknown }).details as { missingLogicalPaths?: readonly string[] } | undefined;
    const paths = details?.missingLogicalPaths;
    const missingLogicalPaths = paths != null && paths.length > 0 ? paths : undefined;
    return {
      code: err.key,
      message: visibleMessage(err, err.message),
      ...(missingLogicalPaths != null ? { missingLogicalPaths } : {}),
    };
  }
  // 7. TdbcError：desktop 无此入口，不设分支（镜像门豁免）。
  // 8. AgentTurnError（infra 保留类）→ AGENT_RUN_FAILED。
  if (err instanceof AgentTurnError) {
    return { code: "AGENT_RUN_FAILED", message: err.message };
  }
  // 9. 未知 Error → INFRA_UNEXPECTED_ERROR（name 只留 message，不进 code）。
  if (err instanceof Error) {
    return { code: "INFRA_UNEXPECTED_ERROR", message: err.message };
  }
  // 10. 非 Error 抛出值。
  return { code: "INFRA_UNEXPECTED_ERROR", message: String(err) };
}
