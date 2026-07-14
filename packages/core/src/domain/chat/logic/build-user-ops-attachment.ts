/**
 * 由 flush 同源 action XML 构造 `user_ops` 附件。
 *
 * @module domain/chat/logic/build-user-ops-attachment
 */

import type { MessageAttachment } from "../model/message-attachment.schema.js";

/**
 * `content` 为现网同源 action XML（非 JSON、非 system-message 包裹）。
 */
export function buildUserOpsAttachment(
  actionsXml: string,
  name = "user_ops",
): MessageAttachment {
  return {
    name,
    source: "user_ops",
    type: "text",
    content: actionsXml.trim(),
  };
}
