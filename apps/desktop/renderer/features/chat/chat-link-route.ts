/**
 * 聊天 markdown 链接的路由意图解析（desktop renderer 侧，node:test 可直测）。
 *
 * 职责拆分（chat-link-file-nav spec）：本文件只做「识别 → 探测 → 意图」，
 * 探测通道注入（ipcVfsRead）；意图执行（selectPreviewFile / ipcAppOpenExternal）
 * 由 ShellNavProvider 接线完成。
 *
 * 命名陷阱（T-L6 双钉）：workspaceScope "chat" 是 core 的 session 域
 * （会话工作区，PreviewPane.toCoreVfsScope 同口径），"session" 是 core 的
 * project 域（项目工作区）。探测顺序：先 chat 域后 session 域。
 *
 * 探测原语：ipcVfsRead 通道现成——ok 即文件存在；一切非 ok（NOT_FOUND /
 * IS_DIRECTORY / 缺会话上下文等）按未命中并留日志，继续下一域或返回
 * not-found（调用方弹「路径不存在」提示）。
 *
 * @module renderer/features/chat/chat-link-route
 */

import { isHttpUrl, resolveChatLinkTarget } from "@novel-master/core/chat";
import type {
  IpcResult,
  VfsReadRequest,
  VfsReadResultDto,
} from "@shared/ipc-types";

/** 探测所需的 ipcVfsRead 面（invokeClient 同形，测试直传 stub）。 */
export type ChatLinkProbeRead = (
  req: VfsReadRequest,
) => Promise<IpcResult<VfsReadResultDto>>;

/** 链接点击的执行意图：应用内 Preview 打开 / 外部浏览器打开 / 路径未命中 / 无动作。 */
export type ChatLinkAction =
  | { kind: "preview"; workspaceScope: "chat" | "session"; path: string }
  | { kind: "external"; url: string }
  | { kind: "not-found"; path: string }
  | { kind: "none" };

/** 会话上下文：chat 域（core session 域）探测必需 projectId+sessionId。 */
export type ChatLinkSessionContext = {
  readonly projectId: string;
  readonly sessionId: string;
} | null;

/** 非侵入日志（renderer 侧 console 语义，测试可注入捕获）。 */
export type ChatLinkLogger = (message: string, detail?: unknown) => void;

/**
 * 解析链接点击意图。
 *
 * 顺序：http(s) → external；core 识别（mailto/非法形态/纯锚点 → none）；
 * chat 域探测（需会话上下文齐全）→ session 域探测 → 命中即 preview；
 * 双未命中 not-found（调用方弹「路径不存在」提示——用户拍板）。
 */
export async function resolveChatLinkAction(
  href: string,
  deps: {
    sessionContext: ChatLinkSessionContext;
    projectContext: { projectId: string } | null;
    vfsRead: ChatLinkProbeRead;
    log?: ChatLinkLogger;
  },
): Promise<ChatLinkAction> {
  const log = deps.log ?? (() => undefined);
  const trimmed = href.trim();
  if (isHttpUrl(trimmed)) {
    return { kind: "external", url: trimmed };
  }
  const target = resolveChatLinkTarget(trimmed);
  if (target == null) {
    return { kind: "none" };
  }
  // ① chat 域（core session 域：会话工作区）
  if (deps.sessionContext != null) {
    const result = await deps.vfsRead({
      workspaceScope: "chat",
      projectId: deps.sessionContext.projectId,
      sessionId: deps.sessionContext.sessionId,
      path: target,
    });
    if (result.ok) {
      return { kind: "preview", workspaceScope: "chat", path: target };
    }
    log("chat link probe miss (chat scope)", {
      path: target,
      code: result.error.code,
    });
  }
  // ② session 域（core project 域：项目工作区）
  if (deps.projectContext != null) {
    const result = await deps.vfsRead({
      workspaceScope: "session",
      projectId: deps.projectContext.projectId,
      path: target,
    });
    if (result.ok) {
      return { kind: "preview", workspaceScope: "session", path: target };
    }
    log("chat link probe miss (session scope)", {
      path: target,
      code: result.error.code,
    });
  }
  return { kind: "not-found", path: target };
}
