/**
 * 用户 VFS UA 两段消息的识别与视图构建。
 *
 * @module domain/chat/logic/vfs-turn/user-vfs-turn-view
 */

import {messageBodyTextFromBlocks} from "../../content/message-body-text.js";
import {stringOrEmpty} from "@/common/coerce.js";
import type {ToolResultBlock, ToolUseBlock} from "../../model/content-block.js";
import type {ChatMessageData} from "../../model/message.js";
import {readMessageMetadata} from "../../model/message-metadata.js";
import {actionXmlToToolUses, type DerivedToolUseInput} from "../../../vfs/logic/action-xml-to-tool-uses.js";
import {buildUserVfsActionXml, parseUserVfsActionsFromText} from "../../../vfs/logic/user-vfs-action-xml.js";
import {attachmentPath} from "../message/attachment-path.js";
import {USER_VFS_TURN_ACK_TEXT} from "./user-vfs-turn-constants.js";

export {USER_VFS_TURN_ACK_TEXT} from "./user-vfs-turn-constants.js";

/** nm-style: keep-local — mobile test-utils/core-shim 与 webview bundle 消费。 */
export type ParsedUserVfsEditHunk = {
    readonly index: string;
    readonly old: string;
    readonly new: string;
};

/** nm-style: keep-local — mobile test-utils/core-shim 与 webview bundle 消费。 */
export type ParsedUserVfsAction = {
    readonly name: string;
    readonly path: string;
    readonly params: Record<string, unknown>;
    readonly kind: string;
    readonly method?: string;
    readonly hunks: readonly ParsedUserVfsEditHunk[];
};

/** nm-style: keep-local — mobile test-utils/core-shim 与 webview bundle 消费。 */
export type UserVfsTurnView = {
    readonly id: string;
    readonly hidden: boolean;
    readonly actions: readonly ParsedUserVfsAction[];
    readonly toolUses: readonly ToolUseBlock[];
    readonly toolResults: readonly ToolResultBlock[];
    readonly bridgeText: string;
};

/** UA 两段在 messages 中的跨度（含首尾 message）。 */
/** nm-style: keep-public — mobile core-shim 与测试消费的 UA 跨度常量。 */
export const USER_VFS_TURN_SPAN = 2 as const;

/** 用户 VFS UA 两段领域服务。 */
class UserVfsTurns {
    /** 解析文本中全部 `<action name="…">`。 */
    parseActions(text: string): readonly ParsedUserVfsAction[] {
        return parseUserVfsActionsFromText(text).map(({name, params}) => {
            let resolvedName = name;
            if (name === "rename" || name === "move") {
                const from = stringOrEmpty(params.from);
                const to = stringOrEmpty(params.to);
                if (from !== "" && to !== "") {
                    resolvedName = attachmentPath.actionBetween(from, to);
                }
            }
            const path = resolvedName === "rename" || resolvedName === "move" ? `${stringOrEmpty(params.from)}→${stringOrEmpty(params.to)}` : stringOrEmpty(params.path);
            const hunks: ParsedUserVfsEditHunk[] = resolvedName === "edit" ? [{index: "1", old: stringOrEmpty(params.oldString), new: stringOrEmpty(params.newString)}] : [];
            return {
                name: resolvedName,
                path,
                params,
                kind: resolvedName,
                method: resolvedName === "write" || resolvedName === "edit" ? resolvedName : undefined,
                hunks,
            };
        });
    }

    /** 从已解析的 action 还原 flush 前的完整 tool input。 */
    /** nm-style: keep-public — UserVfsTurns 派生工具入口，保留服务组合。 */
    deriveToolUses(actions: readonly ParsedUserVfsAction[]): readonly DerivedToolUseInput[] {
        if (actions.length === 0) {
            return [];
        }
        const xmlParts: string[] = [];
        for (const action of actions) {
            if (action.name === "edit" && action.hunks.length > 0) {
                xmlParts.push(action.hunks.map((hunk) => buildUserVfsActionXml("edit", {path: action.path, oldString: hunk.old, newString: hunk.new})).join("\n"));
                continue;
            }
            const [renameFrom = "", renameTo = ""] = action.path.split("→");
            const params = Object.keys(action.params).length > 0 ? action.params : action.name === "rename" || action.name === "move" ? {from: renameFrom, to: renameTo} : {path: action.path};
            xmlParts.push(buildUserVfsActionXml(action.name || action.kind, params));
        }
        return actionXmlToToolUses(xmlParts.join("\n"));
    }

    /** 从 `startIndex` 起是否为完整的用户 VFS UA 两段（均未 hidden）。 */
    /** nm-style: keep-public — core-shim / UI 测试的 VFS 两段匹配入口。 */
    matchAt(messages: readonly ChatMessageData[], startIndex: number): readonly [ChatMessageData, ChatMessageData] | null {
        const m0 = messages[startIndex];
        const m1 = messages[startIndex + 1];
        if (m0 == null || m1 == null) return null;
        if (m0.hidden || m1.hidden) return null;
        if (readMessageMetadata(m0.raw)?.kind !== "user_vfs_action") return null;
        if (!messageBodyTextFromBlocks(m0.content.blocks).includes("<action")) return null;
        if (m1.role !== "assistant") return null;
        if (readMessageMetadata(m1.raw)?.kind !== "user_vfs_ack") return null;
        const ackBlocks = m1.content.blocks ?? [];
        if (ackBlocks.length === 0) return null;
        if (ackBlocks.some((block) => block.type !== "text")) return null;
        if (messageBodyTextFromBlocks(ackBlocks) !== USER_VFS_TURN_ACK_TEXT) return null;
        return [m0, m1];
    }

    /** 从已匹配的 UA 两段构建视图。 */
    /** nm-style: keep-public — core-shim / UI 测试的 VFS 视图构建入口。 */
    buildView(turn: readonly [ChatMessageData, ChatMessageData]): UserVfsTurnView {
        const [actionMsg, ackMsg] = turn;
        const actionText = messageBodyTextFromBlocks(actionMsg.content.blocks);
        const actions = this.parseActions(actionText);
        const toolUses = this.deriveToolUses(actions).map((toolUse, index) => ({
            type: "tool_use" as const,
            id: `vfs-tu-${index}`,
            name: toolUse.name,
            input: toolUse.input,
        }));
        return {
            id: actionMsg.id,
            hidden: actionMsg.hidden || ackMsg.hidden,
            actions,
            toolUses,
            toolResults: toolUses.map((toolUse) => ({
                type: "tool_result" as const,
                toolUseId: toolUse.id,
                content: "ok",
                ok: true
            })),
            bridgeText: messageBodyTextFromBlocks(ackMsg.content.blocks),
        };
    }
}

export const userVfsTurns = new UserVfsTurns();
