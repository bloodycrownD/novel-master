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
   * - `skillRef`：`skill` 的跳转三元组（domain/projectId/name）。read 缺省
   *   域命中生效副本时实际命中域只有工具输出知道，由 `buildToolResultBlock`
   *   从输出自动检测透传到这里；write/edit 必含于 tool_use 输入，UI 侧照
   *   `resolveSkillToolRefFromInput` 解析即可。
   */
  readonly meta?: {
    readonly subagentSessionId?: string;
    readonly failureReason?: string;
    readonly skillRef?: SkillToolRef;
  };
}

/** 技能跳转三元组（`skill` 卡片跳详情用；UI 与 meta 共用形态）。 */
export interface SkillToolRef {
  readonly domain: "global" | "project";
  /** project 域定位用；由解析方按会话上下文补齐，global 域缺省。 */
  readonly projectId?: string;
  readonly name: string;
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
