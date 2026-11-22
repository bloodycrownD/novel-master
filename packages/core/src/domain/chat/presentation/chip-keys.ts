/**
 * 附件 chip 的 key 常量（label.attachment 段；文案本体在 i18n catalog 双语 yaml）。
 *
 * chip 明文是嵌套 descriptor：`{ key: "label.attachment.chip", params: { action: { key }, path } }`，
 * translator 渲染时对 action 位递归取「二字/短词」，再经 `{action}:{path}` 模板插值。
 *
 * @module domain/chat/presentation/chip-keys
 */

import type {MessageAttachmentAction} from "@/domain/chat/model/message-attachment.schema.js";
import type {CoreMessageKey} from "@/i18n/keys.js";

/** chip 模板键（`{action}:{path}`）。 */
export const CHIP_TEMPLATE_KEY = "label.attachment.chip" as const;

/** 裸路径/attach 引用键（`{path}` 直出；webview 附件行与降级 3 用）。 */
export const CHIP_BARE_KEY = "label.attachment.attach_ref" as const;

/** action → 二字/短词 key（userAttach/skillAttach 不进状态 chip，无 key）。 */
export const CHIP_ACTION_KEYS = {
    delete: "label.attachment.action.delete",
    write: "label.attachment.action.write",
    edit: "label.attachment.action.edit",
    mkdir: "label.attachment.action.mkdir",
    /** 同目录换名。 */
    rename: "label.attachment.action.rename",
    /** 跨目录移动。 */
    move: "label.attachment.action.move",
    workplaceChange: "label.attachment.action.workplace_change",
    annotate: "label.attachment.action.annotate",
} as const satisfies Partial<Record<MessageAttachmentAction, CoreMessageKey>>;
