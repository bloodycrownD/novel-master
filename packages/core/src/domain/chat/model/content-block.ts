/**
 * Canonical message content blocks stored in `content_json`.
 *
 * @module domain/chat/model/content-block
 */

/** Union of all supported content block variants. */
export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | RedactedThinkingBlock;

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface ImageBlock {
  readonly type: "image";
  readonly source: ImageSource;
}

export type ImageSource =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "base64"; readonly mediaType: string; readonly data: string };

export interface ToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  /** Opaque round-trip signature (Gemini thought_signature on functionCall parts). */
  readonly thinkingSignature?: string;
}

export interface ToolResultBlock {
  readonly type: "tool_result";
  readonly toolUseId: string;
  readonly content: string;
  /** Runner outcome; omitted on legacy rows (UI falls back to `Error:` prefix). */
  readonly ok?: boolean;
  /** Short UI hint; not sent to LLM adapters. */
  readonly summary?: string;
}

export interface ThinkingBlock {
  readonly type: "thinking";
  readonly text: string;
  /** Opaque round-trip signature (Gemini thought_signature / Anthropic signature). */
  readonly thinkingSignature?: string;
}

export interface RedactedThinkingBlock {
  readonly type: "redacted_thinking";
  /** Anthropic redacted_thinking.data — opaque, must round-trip verbatim. */
  readonly data: string;
  readonly thinkingSignature?: string;
}

/** Message body: only `{ blocks: ContentBlock[] }` is valid at rest. */
export interface MessageContent {
  readonly blocks: readonly ContentBlock[];
}
