/**
 * Prompt block model (text and chat segments).
 *
 * @module domain/prompt/model/prompt-block
 */

/** Role prefix for text blocks and chat message lines. */
export type PromptBlockRole = "system" | "user" | "assistant";

/** A single block in a prompt definition file. */
export type PromptBlock =
  | {
      readonly name: string;
      readonly type: "text";
      readonly role: PromptBlockRole;
      readonly content: string;
    }
  | {
      readonly name: string;
      readonly type: "chat";
    };
