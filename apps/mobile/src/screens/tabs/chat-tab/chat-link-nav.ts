/**
 * 聊天 markdown 链接的路由意图解析（mobile 主会话 / 子会话共用）。
 *
 * 职责拆分（chat-link-file-nav spec）：本文件只做「识别 → 探测 → 意图」，
 * 纯依赖注入、可导入直测；意图执行（openFileEditor / Linking 外跳）由
 * useChatTabScope.openChatLink 与 SubagentSessionScreen 各自接线完成。
 *
 * 探测原语：VfsService 无 stat、read 拉全文代价大、glob 有转义问题，
 * 故用 `list(parent)` 单层列举比对 basename——父目录不存在时 list 抛错，
 * 一律按不存在处理。仅 `kind === 'file'` 命中（目录目标 no-op）。
 *
 * @module screens/tabs/chat-tab/chat-link-nav
 */

import {resolveChatLinkTarget} from '@novel-master/core/chat';
import type {VfsListEntry} from '@novel-master/core/vfs';

/** 探测所需的最小 VFS 面（VfsService.list 的结构子集，测试可直传 stub）。 */
export type ChatLinkProbeVfs = {
  list(dir: string): Promise<readonly VfsListEntry[]>;
};

/** 链接点击的执行意图：应用内打开文件 / 外跳系统浏览器 / 无动作。 */
export type ChatLinkOpenIntent =
  | {kind: 'file'; scope: 'session' | 'project'; path: string}
  | {kind: 'external'; url: string}
  | {kind: 'none'};

/** http(s) 外跳判定（承接原 webview 导航守卫的主路径职责）。 */
const HTTPS_PATTERN = /^https?:\/\//i;

/**
 * 解析链接点击意图。
 *
 * 顺序：http(s) 直接外跳；其余交 core 单源识别（mailto 及非法形态 → none）；
 * 识别出的逻辑路径先探 session 工作区、再探 project 工作区（spec 定序），
 * 命中文件返回打开意图，双未命中返回 none（调用方 no-op）。
 */
export async function resolveChatLinkIntent(
  href: string,
  deps: {sessionVfs: ChatLinkProbeVfs | null; projectVfs: ChatLinkProbeVfs | null},
): Promise<ChatLinkOpenIntent> {
  const trimmed = href.trim();
  if (HTTPS_PATTERN.test(trimmed)) {
    return {kind: 'external', url: trimmed};
  }
  // mailto 及其它 scheme、非法序列、纯锚点等均为 null → 维持现状无动作
  const target = resolveChatLinkTarget(trimmed);
  if (target == null) {
    return {kind: 'none'};
  }
  if (await probeFileIn(deps.sessionVfs, target)) {
    return {kind: 'file', scope: 'session', path: target};
  }
  if (await probeFileIn(deps.projectVfs, target)) {
    return {kind: 'file', scope: 'project', path: target};
  }
  return {kind: 'none'};
}

/** 在单个工作区探测归一化路径是否为已存在的文件（目录不算命中）。 */
async function probeFileIn(
  vfs: ChatLinkProbeVfs | null,
  normalizedPath: string,
): Promise<boolean> {
  if (vfs == null) {
    return false;
  }
  const slash = normalizedPath.lastIndexOf('/');
  const parentDir = slash <= 0 ? '/' : normalizedPath.slice(0, slash);
  try {
    const entries = await vfs.list(parentDir);
    return entries.some(
      entry => entry.path === normalizedPath && entry.kind === 'file',
    );
  } catch {
    // 父目录 NOT_FOUND 及一切探测异常按不存在处理
    return false;
  }
}
