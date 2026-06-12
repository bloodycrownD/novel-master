/**
 * Prompt block model (text and chat segments).
 *
 * @module domain/prompt/model/prompt-block
 */

/** Role prefix for text blocks and chat message lines. */
export type PromptBlockRole = "system" | "user" | "assistant";

/** Inclusion policy for non-system text blocks in prompt assembly. */
export type PromptBlockLifecycle = "always" | "once";

/** A single block in a prompt definition file. */
export type PromptBlock =
  | {
      readonly name: string;
      readonly type: "text";
      readonly role: PromptBlockRole;
      readonly content: string;
      /** Defaults to `always` when omitted. */
      readonly lifecycle?: PromptBlockLifecycle;
    }
  | {
      readonly name: string;
      readonly type: "chat";
    };
