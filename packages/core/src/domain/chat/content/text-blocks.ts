/**
 * Convenience constructors for message content in tests and CLI.
 *
 * @module domain/chat/content/text-blocks
 */

import type { MessageContent } from "../model/content-block.js";

export const TextBlocks = {
    /** Single text block; shorthand for tests and `nm message append --content`. */
    of(text: string): MessageContent {
        return { blocks: [{ type: "text", text }] };
    },
} as const;
