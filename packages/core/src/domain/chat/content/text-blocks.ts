/**
 * Convenience constructors for message content in tests and CLI.
 *
 * @module domain/chat/content/text-blocks
 */

import type { MessageContent } from "../model/content-block.js";

/** Single text block; shorthand for tests and `nm message append --content`. */
export function textBlocks(text: string): MessageContent {
  return { blocks: [{ type: "text", text }] };
}
