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
  /**
   * meta 字段同时供 UI 卡片读取；task 工具 content 改全 JSON 后（59d84726），
   * subagentSessionId 与 failureReason 也会随 content 回流给 LLM。
   *
   * - `subagentSessionId`：`task` 工具把子 agent 跑完的子 session id 写进这里，
   *   供 UI 工具卡片点击跳转子会话只读浏览。
   * - `failureReason`：phase-1-abort-reflow 中断回流时，子 agent 被用户停止
   *   的失败原因文案，让 UI 能在卡片上提示「用户停止」而非笼统失败。
   */
  readonly meta?: {
    readonly subagentSessionId?: string;
    readonly failureReason?: string;
  };
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
