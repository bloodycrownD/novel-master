/**
 * 附件 action XML codec：userAttach / workplaceChange / annotate 的编码与解码。
 *
 * 领域编解码器；不依赖 UI，不直接落库。
 *
 * @module domain/chat/logic/attachment/attachment-xml-codec
 */

import {buildUserVfsActionXml} from "@/domain/vfs/logic/user-vfs-save-mapping.js";
import {integerAtLeast, stringOrEmpty} from "@/common/coerce.js";
import {type AnnotateDraft, isMessageAnnotatePath} from "../../model/annotate-draft.schema.js";
import {attachmentStorageName, type MessageAttachment} from "../../model/message-attachment.schema.js";
import {userVfsTurns} from "../vfs-turn/user-vfs-turn-view.js";

type AttachmentDisplayKind = "full" | "filename" | "header";

/** 附件 XML 编解码器。 */
class AttachmentXmlCodec {
    /** `userAttach` / `workplaceChange`：全文 / filename / header（行号正文）。 */
    encodeFileRef(params: {
        readonly action: "userAttach" | "workplaceChange";
        readonly path: string;
        readonly content: string;
        readonly display: AttachmentDisplayKind
    }): string {
        return buildUserVfsActionXml(params.action, {
            path: params.path,
            content: params.content,
            display: params.display,
        });
    }

    /** 目录树：`kind: "dirTree"`，content = ASCII 树（无外层 `<dir>`）。 */
    encodeDirTree(path: string, treeBody: string): string {
        return buildUserVfsActionXml("userAttach", {
            path,
            content: treeBody,
            kind: "dirTree",
        });
    }

    /** 由文件形批注草稿构造落库附件（`source:user_ops` + `action:annotate`）。 */
    encodeAnnotateAttachment(draft: AnnotateDraft): MessageAttachment {
        const path = draft.path;
        const params: Record<string, unknown> = {
            path,
            originalText: draft.originalText,
            userAnnotation: draft.userAnnotation
        };
        for (const key of ["renderStart", "renderEnd", "startOffset", "endOffset", "startLine", "endLine", "startCol", "endCol"] as const) {
            const value = draft[key];
            if (value != null) {
                params[key] = value;
            }
        }
        const {startLine, endLine} = draft;
        if (typeof startLine === "number" && Number.isFinite(startLine) && startLine >= 1) {
            const start = Math.floor(startLine);
            const end = typeof endLine === "number" && Number.isFinite(endLine) && endLine >= 1 ? Math.max(start, Math.floor(endLine)) : start;
            params.locationLabel = start === end ? `第 ${start} 行` : `第 ${start}-${end} 行`;
        }
        const xml = buildUserVfsActionXml("annotate", params);
        return {
            name: attachmentStorageName(path),
            source: "user_ops",
            type: "text",
            content: xml,
            path,
            action: "annotate",
        };
    }

    /** 从消息 attachments 解析可 Undo 恢复的工作区批注草稿；每条新 mint id。 */
    decodeAnnotateDrafts(attachments: readonly MessageAttachment[] | null | undefined): AnnotateDraft[] {
        if (attachments == null || attachments.length === 0) {
            return [];
        }
        const out: AnnotateDraft[] = [];
        for (const att of attachments) {
            if (att.action !== "annotate") {
                continue;
            }
            let path = typeof att.path === "string" && att.path !== "" ? att.path : undefined;
            let originalText = "";
            let userAnnotation = "";
            let renderStart: number | undefined;
            let renderEnd: number | undefined;
            let startOffset: number | undefined;
            let endOffset: number | undefined;
            let startLine: number | undefined;
            let endLine: number | undefined;
            let startCol: number | undefined;
            let endCol: number | undefined;
            if (typeof att.content === "string") {
                const actions = userVfsTurns.parseActions(att.content);
                const annotate = actions.find((a) => a.name === "annotate");
                if (annotate != null) {
                    if (!path) {
                        path = stringOrEmpty(annotate.params.path) || annotate.path;
                    }
                    originalText = stringOrEmpty(annotate.params.originalText);
                    userAnnotation = stringOrEmpty(annotate.params.userAnnotation);
                    renderStart = integerAtLeast(annotate.params.renderStart, 0);
                    renderEnd = integerAtLeast(annotate.params.renderEnd, 0);
                    startOffset = integerAtLeast(annotate.params.startOffset, 0);
                    endOffset = integerAtLeast(annotate.params.endOffset, 0);
                    startLine = integerAtLeast(annotate.params.startLine, 1);
                    endLine = integerAtLeast(annotate.params.endLine, 1);
                    startCol = integerAtLeast(annotate.params.startCol, 1);
                    endCol = integerAtLeast(annotate.params.endCol, 1);
                }
            }
            if (!path || isMessageAnnotatePath(path)) {
                continue;
            }
            const renderOk = renderStart != null && renderEnd != null && renderStart < renderEnd;
            const offsetsOk = startOffset != null && endOffset != null && startOffset < endOffset;
            out.push({
                id: `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
                path,
                originalText,
                userAnnotation,
                ...(renderOk ? {renderStart, renderEnd} : {}),
                ...(offsetsOk ? {startOffset, endOffset} : {}),
                ...(startLine != null ? {startLine} : {}),
                ...(endLine != null ? {endLine} : {}),
                ...(startCol != null ? {startCol} : {}),
                ...(endCol != null ? {endCol} : {}),
            });
        }
        return out;
    }
}

export const attachmentXmlCodec = new AttachmentXmlCodec();
