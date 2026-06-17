/**
 * 用户 VFS UA 两段落库常量与 system-message 包裹。
 *
 * @module domain/chat/logic/user-vfs-turn-constants
 */

/** flush 后 assistant ack 固定文案。 */
export const USER_VFS_TURN_ACK_TEXT = "收到通知" as const;

/** 将 pending 合并后的 actionXml 包裹为落库 user 条正文。 */
export function wrapUserVfsActionsForStorage(actionsXml: string): string {
  return `<system-message>\n${actionsXml.trim()}\n</system-message>`;
}
