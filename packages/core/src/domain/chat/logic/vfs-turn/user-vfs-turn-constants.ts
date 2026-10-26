/**
 * 用户 VFS UA 两段落库常量与 system-message 包裹。
 *
 * @module domain/chat/logic/vfs-turn/user-vfs-turn-constants
 */

/** flush 后 assistant ack 固定文案。 */
export const USER_VFS_TURN_ACK_TEXT = "收到通知" as const;

/** 用户 VFS action XML 的落库包裹（无状态命名空间；不是领域对象）。 */
export const userVfsTurnStorage = {
    /** nm-style: keep-public — 双端测试构造 VFS action 文本。 */
    wrapActions(actionsXml: string): string {
        return `<system-message>\n${actionsXml.trim()}\n</system-message>`;
    },
};
