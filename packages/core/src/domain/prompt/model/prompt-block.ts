/**
 * Prompt block model (text and chat segments).
 *
 * @module domain/prompt/model/prompt-block
 */

/** Inclusion policy for non-system text blocks in prompt assembly. */
export type PromptBlockLifecycle = "always" | "once";