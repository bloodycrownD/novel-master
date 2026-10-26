/**
 * 批注草稿进程内会话 Map（subscribe / CRUD / chip 投影）。
 * 允许 App 经本 API 读写；禁止写入 `composer_draft_json`。
 *
 * 状态（`bySession` / `listeners`）归属 `ChatAnnotateDraftStore` 实例；
 * 模块只保留函数入口的方法引用，避免三端调用点迁移。
 *
 * @module domain/chat/logic/chat-annotate-draft-store
 */

import {type AnnotateDraft, isMessageAnnotatePath} from "../model/annotate-draft.schema.js";
import type {MessageAttachment} from "../model/message-attachment.schema.js";

type AnnotateListener = (sessionId: string) => void;

function notifyListeners(listeners: ReadonlySet<AnnotateListener>, sessionId: string): void {
    for (const listener of listeners) {
        listener(sessionId);
    }
}

class ChatAnnotateDraftStore {
    private readonly bySession = new Map<string, AnnotateDraft[]>();
    private readonly listeners = new Set<AnnotateListener>();

    readonly subscribe = (listener: AnnotateListener): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /** 读本会话未发送批注草稿（快照）。 */
    readonly list = (sessionId: string | undefined): readonly AnnotateDraft[] => {
        if (sessionId == null || sessionId === "") {
            return [];
        }
        return (this.bySession.get(sessionId) ?? []).map((d) => ({...d}));
    };

    /** 本会话是否有未发送批注。 */
    readonly has = (sessionId: string | undefined): boolean => {
        if (sessionId == null || sessionId === "") {
            return false;
        }
        return (this.bySession.get(sessionId)?.length ?? 0) > 0;
    };

    /**
     * 按 path 聚合一只 annotate 预览 chip（`source:user_ops` + `action:annotate`）。
     * **忽略**历史消息批注伪 path（`path.includes('__message__:')`）——防御误写入。
     */
    readonly chips = (sessionId: string | undefined): MessageAttachment[] => {
        const drafts = this.list(sessionId);
        const seen = new Set<string>();
        const chips: MessageAttachment[] = [];
        for (const d of drafts) {
            // 消息批注永不进 chip（防御误写入文件 store 的伪 path）
            if (isMessageAnnotatePath(d.path)) {
                continue;
            }
            if (seen.has(d.path)) {
                continue;
            }
            seen.add(d.path);
            chips.push({
                name: d.path,
                source: "user_ops",
                type: "text",
                content: null,
                path: d.path,
                action: "annotate",
            });
        }
        return chips;
    };

    /**
     * 投影结果 ∪ annotate store chips（按 path 一只）。
     * 先去掉既有 annotate 预览，再合并 store，避免重复。
     */
    readonly union = (projected: readonly MessageAttachment[], sessionId: string | undefined): MessageAttachment[] => {
        const withoutAnnotate = projected.filter((a) => a.action !== "annotate");
        return [...withoutAnnotate, ...this.chips(sessionId)];
    };

    /** 新增一条批注草稿。 */
    readonly add = (sessionId: string, draft: AnnotateDraft): void => {
        if (sessionId === "") {
            return;
        }
        const prev = this.bySession.get(sessionId) ?? [];
        this.bySession.set(sessionId, [...prev, {...draft}]);
        notifyListeners(this.listeners, sessionId);
    };

    /** 更新一条批注说明（按 id）。 */
    readonly update = (sessionId: string, id: string, patch: Pick<AnnotateDraft, "userAnnotation"> & Partial<Pick<AnnotateDraft, "originalText">>): void => {
        if (sessionId === "") {
            return;
        }
        const prev = this.bySession.get(sessionId);
        if (prev == null) {
            return;
        }
        let changed = false;
        const next = prev.map((d) => {
            if (d.id !== id) {
                return d;
            }
            changed = true;
            return {...d, originalText: patch.originalText ?? d.originalText, userAnnotation: patch.userAnnotation};
        });
        if (!changed) {
            return;
        }
        this.bySession.set(sessionId, next);
        notifyListeners(this.listeners, sessionId);
    };

    /** 删除一条批注草稿。 */
    readonly remove = (sessionId: string, id: string): void => {
        if (sessionId === "") {
            return;
        }
        const prev = this.bySession.get(sessionId);
        if (prev == null) {
            return;
        }
        const next = prev.filter((draft) => draft.id !== id);
        if (next.length === prev.length) {
            return;
        }
        if (next.length === 0) {
            this.bySession.delete(sessionId);
        } else {
            this.bySession.set(sessionId, next);
        }
        notifyListeners(this.listeners, sessionId);
    };

    /** append 成功后清空本会话批注。 */
    readonly clear = (sessionId: string | undefined): void => {
        if (sessionId == null || sessionId === "") {
            return;
        }
        if (!this.bySession.has(sessionId)) {
            return;
        }
        this.bySession.delete(sessionId);
        notifyListeners(this.listeners, sessionId);
    };

    /** 测试用：清空全部会话批注。 */
    readonly resetForTests = (): void => {
        this.bySession.clear();
    };
}

/** 进程内批注草稿 store 单例；调用方使用 `chatAnnotateDraftStore.method(...)`。 */
export const chatAnnotateDraftStore = new ChatAnnotateDraftStore();
