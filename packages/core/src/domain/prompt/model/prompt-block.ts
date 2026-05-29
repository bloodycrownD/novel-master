/**
 * Prompt block model (text and chat segments).
 *
 * @module domain/prompt/model/prompt-block
 */

import type { PromptBlockWhen } from "./prompt-block-when.js";

/** Role prefix for text blocks and chat message lines. */
export type PromptBlockRole = "system" | "user" | "assistant";

/** A single block in a prompt definition file. */
export type PromptBlock =
  | {
      readonly name: string;
      readonly type: "text";
      readonly role: PromptBlockRole;
      readonly content: string;
      /** Declarative visibility; only on text blocks. */
      readonly when?: PromptBlockWhen;
    }
  | {
      readonly name: string;
      readonly type: "chat";
    };
