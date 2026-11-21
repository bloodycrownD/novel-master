/**
 * Prompt → LLM input and CLI formatting（三区 layout；workplace 双段在 persist 文本与 chat 之前注入）。
 *
 * 对外的唯一入口是 {@link PromptBuilder}：zones / assemble / llmInput / previewSegments /
 * cliText / previewTurns。模块内扁平函数只是实现，不再单独导出。
 *
 * @module service/prompt/render-prompt
 */

import { ChatMessage } from "../../domain/chat/logic/message/chat-message.js";
import type { ChatMessageData } from "../../domain/chat/model/message.js";
import type { MessageLike } from "../../common/i18n.js";
import { Text } from "../../common/text.js";
import { TextBlocks } from "../../domain/chat/content/text-blocks.js";
import { MessageBodyText, flushTextCard } from "../../domain/chat/content/message-body-text.js";
import type { ContentBlock, ToolResultBlock as ChatToolResultBlock } from "../../domain/chat/model/content-block.js";
import { AgentPromptLayout, DEFAULT_SKILLS_INDEX_PREFIX } from "../../domain/prompt/model/agent-prompt-layout.js";
import { DynamicMacrosExpansion } from "../../domain/prompt/logic/expand-dynamic-macros.js";
import type { LlmExportZones } from "../../domain/prompt/logic/normalize-for-llm-export.js";
import type { PromptLlmInput, PromptRenderContext, PromptSkillIndexEntry } from "../../domain/prompt/model/prompt-render-context.js";
import { ToolResultBlock } from "../../domain/tool/logic/build-tool-result-block.js";
import { ToolOutput } from "../../domain/tool/logic/format-tool-output.js";
import type { AppError } from "../../errors/app-error.js";
import { Result } from "../../errors/either.js";

export type { PromptLlmInput, PromptRenderContext } from "../../domain/prompt/model/prompt-render-context.js";

/** One segment from the single assembly traversal (preview / serialize / preview turns). */
interface PromptAssemblySegment {
  readonly id: string;
  readonly role: string;
  readonly title: string;
  readonly body: string;
  readonly source: "template" | "message" | "system";
  /** 来源 ChatMessageData id（仅 `source === "message"` 有值）；轮聚合按它分组。 */
  readonly messageId?: string;
  /** 来源 ChatMessageData 的会话内序号（仅 `source === "message"` 有值）。 */
  readonly seq?: number;
}

/** One collapsible preview card in CLI / mobile real-prompt UI. */
interface PromptPreviewSegment {
  readonly id: string;
  readonly role: string;
  readonly title: string;
  readonly body: string;
}

/** Agent run step context for prompt assembly (defaults to step 0). */
export interface PromptAssemblyOptions {
  /** Agent run step index; 0 = first LLM round after user action. */
  readonly agentStepIndex?: number;
  /**
   * 预览时是否产出 thinking 段（opt-in，默认 false）：CLI 文本与
   * `serializePromptLlmInput` token 计数 parity 沿用不含 thinking 的现状。
   */
  readonly includeThinkingBlocks?: boolean;
}

/** `PromptBuilder.zones` 的可选区来源：workplace 展示串 / 技能索引条目。 */
interface LlmExportZonesOptions extends PromptAssemblyOptions {
  readonly workplaceDisplay?: string;
  readonly skillsIndex?: readonly PromptSkillIndexEntry[];
}

/**
 * 计算 `PromptBuilder.llmInput` 输出 messages 的三区边界。
 *
 * @remarks 传入 `workplaceDisplay` 时与注入逻辑一致：空串不算 workplace 双段；
 * `skillsIndex` 非空时计入 persist 前缀（技能索引合成消息 1 条）。
 */
function computeLlmExportZonesFromLayout(layout: AgentPromptLayout, options?: LlmExportZonesOptions): LlmExportZones {
  const agentStepIndex = resolveAgentStepIndex(options);
  const injectWorkplace = AgentPromptLayout.hasWorkplace(layout) && (options?.workplaceDisplay === undefined || options.workplaceDisplay.trim() !== "");
  const textBlockCount = layout.persist.length;
  const persistCount = (options?.skillsIndex?.length ? 1 : 0) + (injectWorkplace ? 2 : 0) + (layout.persistEnabled === true ? textBlockCount : 0);
  // dynamic 区一律 once 语义：仅 step 0 注入（缺省 0 ⇒ preview/token 链恒含）。
  const dynamicCount = layout.dynamicEnabled === true && agentStepIndex === 0 ? layout.dynamic.length : 0;
  return { persistCount, dynamicCount };
}

function resolveAgentStepIndex(options?: PromptAssemblyOptions): number {
  return options?.agentStepIndex ?? 0;
}

/** 合成提示词消息：id / role / 正文由调用方定，会话 id 取首个消息（与 wire 端一致）。 */
function syntheticPromptMessage(id: string, role: string, body: string, ctx: PromptRenderContext): ChatMessageData {
  return {
    id,
    sessionId: ctx.messages[0]?.sessionId ?? "",
    seq: 0,
    role,
    content: TextBlocks.of(body),
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
  };
}

/** 技能索引段正文：前缀语（缺省默认）+ 每条「名称：描述（来源域）」。 */
function formatSkillsIndexBody(entries: readonly PromptSkillIndexEntry[], prefix?: string): string {
  const lines = entries.map((entry) => {
    const description = entry.description.trim();
    const descSuffix = description !== "" ? `：${description}` : "";
    return `- ${entry.name}${descSuffix}（${entry.domain}）`;
  });
  const header = prefix != null && prefix.trim().length > 0 ? prefix.trim() : DEFAULT_SKILLS_INDEX_PREFIX;
  return [header, ...lines].join("\n");
}

/**
 * 三区 layout 单次遍历：system → skills 索引（若预算非空）→ workplace 双段（若开启）
 * → persist 文本 → chat → dynamic。
 *
 * 五期门⑦：dynamic 宏展开失败沿 `Result.err` 回传（不再 throw）——调用方（turn loop /
 * 两端 buildSessionPromptInput / chip 读口）按 `!ok` 分支收口。
 */
async function buildPromptAssemblyFromLayout(layout: AgentPromptLayout, ctx: PromptRenderContext, options?: PromptAssemblyOptions): Promise<Result<readonly PromptAssemblySegment[], AppError>> {
  const agentStepIndex = resolveAgentStepIndex(options);
  const segments: PromptAssemblySegment[] = [];
  let segmentIndex = 0;

  if (layout.system != null && layout.system.trim() !== "") {
    segments.push({
      id: "system",
      role: "system",
      title: "system",
      body: layout.system,
      source: "system",
    });
  }

  // skillsEnabled=false（技能总开关关）：不注入索引段（resolve 侧已摘 skill 工具，
  // 此处渲染层双保险——ctx 直接携带 skillsIndex 也不注入）。
  if (layout.skillsEnabled !== false && ctx.skillsIndex != null && ctx.skillsIndex.length > 0) {
    segments.push({
      id: "prompt-skills",
      role: "user",
      title: "skills",
      body: formatSkillsIndexBody(ctx.skillsIndex, layout.skillsPrefix),
      source: "template",
    });
  }

  // `workplace` 开且展示非空时追加 user 文件树 + assistant 配置确认语两段。
  if (AgentPromptLayout.hasWorkplace(layout) && ctx.workplaceDisplay.trim() !== "") {
    segments.push({
      id: "prompt-workplace",
      role: "user",
      title: "workplace",
      body: ctx.workplaceDisplay,
      source: "template",
    });
    segments.push({
      id: "prompt-workplace-done",
      role: "assistant",
      title: "workplace · done",
      body: layout.workplace!,
      source: "template",
    });
  }

  if (layout.persistEnabled === true) {
    for (const block of layout.persist) {
      segments.push({
        id: `persist-${block.name}`,
        role: block.role,
        title: block.name,
        body: block.content,
        source: "template",
      });
    }
  }

  for (let messageIndex = 0; messageIndex < ctx.messages.length; messageIndex++) {
    const message = ctx.messages[messageIndex]!;
    if (message.hidden) {
      continue;
    }
    const messageSegments = MessageBodyText.formatForCliPreview(message, {
      includeThinking: options?.includeThinkingBlocks === true,
    });
    for (let i = 0; i < messageSegments.length; i++) {
      const segment = messageSegments[i]!;
      segments.push({
        id: `chat-${message.id}-${segmentIndex}`,
        role: segment.role,
        title: `#${message.seq} · ${segment.role}`,
        body: segment.body,
        source: "message",
        messageId: message.id,
        seq: message.seq,
      });
      segmentIndex += 1;
    }
  }

  if (layout.dynamicEnabled === true && agentStepIndex === 0) {
    for (const block of layout.dynamic) {
      const expanded = await DynamicMacrosExpansion.expand(block.content, { now: ctx.now, workplace: ctx.workplace, filetree: ctx.filetree });
      if (!expanded.ok) {
        return Result.err(expanded.error);
      }
      segments.push({
        id: `dynamic-${block.name}`,
        role: block.role,
        title: block.name,
        body: expanded.value,
        source: "template",
      });
    }
  }

  return Result.ok(segments);
}

/**
 * 构建 LLM 输入：system 字段 + persist 合成消息 + chat + dynamic。
 *
 * 五期门⑦：同 {@link buildPromptAssemblyFromLayout}，dynamic 宏展开失败沿
 * `Result.err` 回传，调用方按 `!ok` 分支收口。
 *
 * @remarks 本函数**不能**由 assembly 段转出（刻意保留独立实现）：`PromptLlmInput.messages`
 * 是 `ChatMessageData`，而 assembly 段是面向预览的文本投影——段里没有 `sessionId` /
 * `content`（blocks 结构）/ `provider` / `providerId` / `modelName` / `raw` /
 * `createdAtMs` / `hidden` / `attachments` / `usage`；`MessageBodyText.formatForCliPreview`
 * 还会 trim 文本、默认丢弃 thinking、把 tool_result 段 unshift 到消息段首，并且
 * 只含 thinking 的可见消息产出 0 段。按段反推消息必然失真。两处 gating 的语义
 * 由 lifecycle 测试（zones/assembly/llmInput 三组）共同钉住。
 */
async function buildPromptLlmInputFromLayout(layout: AgentPromptLayout, ctx: PromptRenderContext, options?: PromptAssemblyOptions): Promise<Result<PromptLlmInput, AppError>> {
  const agentStepIndex = resolveAgentStepIndex(options);
  const messages: ChatMessageData[] = [];

  if (layout.skillsEnabled !== false && ctx.skillsIndex != null && ctx.skillsIndex.length > 0) {
    messages.push(syntheticPromptMessage("prompt:skills", "user", formatSkillsIndexBody(ctx.skillsIndex, layout.skillsPrefix), ctx));
  }

  // `workplace` 开且展示非空时追加 user 文件树 + assistant 配置确认语（assemble 已包 `<workplace>`，此处勿再包）。
  if (AgentPromptLayout.hasWorkplace(layout) && ctx.workplaceDisplay.trim() !== "") {
    messages.push(syntheticPromptMessage("prompt:workplace", "user", ctx.workplaceDisplay, ctx));
    messages.push(syntheticPromptMessage("prompt:workplace:done", "assistant", layout.workplace!, ctx));
  }

  if (layout.persistEnabled === true) {
    for (const block of layout.persist) {
      messages.push(syntheticPromptMessage(`prompt:${block.name}`, block.role, block.content, ctx));
    }
  }

  messages.push(...ctx.messages.filter((m) => !m.hidden));

  if (layout.dynamicEnabled === true && agentStepIndex === 0) {
    for (const block of layout.dynamic) {
      const expanded = await DynamicMacrosExpansion.expand(block.content, { now: ctx.now, workplace: ctx.workplace, filetree: ctx.filetree });
      if (!expanded.ok) {
        return Result.err(expanded.error);
      }
      messages.push(syntheticPromptMessage(`prompt:${block.name}`, block.role, expanded.value, ctx));
    }
  }

  const system = layout.system != null && layout.system.trim() !== "" ? layout.system : undefined;

  return Result.ok({ system, messages });
}

/** 构建有序预览分段（每段一张卡片）。 */
async function buildPromptPreviewSegmentsFromLayout(layout: AgentPromptLayout, ctx: PromptRenderContext, options?: PromptAssemblyOptions): Promise<Result<PromptPreviewSegment[], AppError>> {
  const assembled = await buildPromptAssemblyFromLayout(layout, ctx, options);
  if (!assembled.ok) {
    return Result.err(assembled.error);
  }
  return Result.ok(assembled.value.map((segment) => ({ id: segment.id, role: segment.role, title: segment.title, body: segment.body })));
}

/**
 * CLI 预览与 token 计数用的 role 前缀纯文本。
 *
 * 跨包契约：infra/tokenizer 以 `serializePromptLlmInput` 别名转发本实现
 * （`PromptBuilder.cliText`），三端 token 面（含 tokenizer-driver-node/rn）消费。
 */
async function formatPromptLlmInputForCliFromLayout(layout: AgentPromptLayout, ctx: PromptRenderContext, options?: PromptAssemblyOptions): Promise<Result<string, AppError>> {
  const assembled = await buildPromptAssemblyFromLayout(layout, ctx, options);
  if (!assembled.ok) {
    return Result.err(assembled.error);
  }
  const lines = assembled.value.map((segment) => {
    const bodyLines = segment.body.replace(/\r\n/g, "\n").split("\n");
    return bodyLines.length === 1 ? `${segment.role}: ${bodyLines[0]}` : `${segment.role}: ${bodyLines[0]}\n${bodyLines.slice(1).join("\n")}`;
  });
  return Result.ok(lines.join("\n"));
}

// ==== Preview turns（显示层口径：行号剥离只发生在本区段，wire 成员不得引用） ====

/** 工具组卡状态：`ok` 成功 / `error` 失败（显式 `ok:false` 或 legacy `Error:` 前缀）/ `lost` 悬挂未回结果。 */
type PromptToolGroupStatus = "ok" | "error" | "lost";

/** 工具组卡的结果格数据；`null` 表示悬挂 use（丢失占位，槽位保留）。 */
interface PromptToolGroupResultData {
  readonly toolUseId: string;
  /** `ToolResultBlock.resolveOk` 产出（显式 `ok` 优先，legacy 回落 `Error:` 前缀）。 */
  readonly ok: boolean;
  /**
   * 结果正文 —— **cards 为显示层口径（已剥行号），items/body 为 wire parity 口径（保留行号）**。
   *
   * @remarks 剥的是 read / skill load 的 `padStart(6," ")` 右对齐行号（判据
   * `TOOL_RESULT_LINE_PREFIX`，经 `Text.stripLinePrefix` 逐行至多剥一次）；wire 侧
   * 同源正文在 `PromptPreviewTurn.items` / `.body` 里原样保留。
   */
  readonly body: string;
}

/** 工具调用组卡：一次 `tool_use` 一张，跨消息按 `toolUseId` 与 `tool_result` 配对。 */
export interface PromptToolGroupCardData {
  readonly type: "toolGroup";
  readonly id: string;
  readonly toolName: string;
  /** `JSON.stringify(input, null, 2)`；`input` 为 `{}` 时退化为 `[tool_use name=… id=…]` 单行（与 CLI 形态一致）。 */
  readonly inputJson: string;
  readonly result: PromptToolGroupResultData | null;
  readonly status: PromptToolGroupStatus;
  /** 同一消息内多个 `tool_use`（并行调用徽标）。 */
  readonly parallel: boolean;
}

/** 文本 / thinking 卡：正文即「发给模型（或预览开关打开时的思考块）」的形态。 */
export interface PromptTextCardData {
  readonly type: "text" | "thinking";
  /** 独立命名空间 `card-${message.id}-${blockIndex}`（合成段轮卡用段 id）；仅要求轮内唯一。 */
  readonly id: string;
  /** 展示标签用（详情标题源）：user / assistant / 合成段名（system、skills、workplace…）。 */
  readonly role: string;
  /**
   * 卡片正文 —— **cards 为显示层口径**，与 items/body 的 wire parity 口径可能不同。
   *
   * @remarks 唯一的差异面：user 轮附件 action 块 `"content"` 值内的**转义行号已剥**
   * （见 {@link stripAttachmentContentLinePrefix}）。对话正文 / assistant 正文 /
   * thinking 正文**一律一字不动**（不剥行号，避免误伤用户与模型的正文）。
   */
  readonly body: string;
}

/**
 * nm-style: keep-public — desktop IPC handler 经 inline `import("@novel-master/core/prompt")` 类型消费；find-fake-exports 不统计 ImportTypeNode。
 * workplace 单文件格：块内正文（**cards 已剥行号**）+ 展示档（快照条目原值）。
 */
export interface PromptWorkplaceFileCardData {
  /** VFS 逻辑路径（规则快照条目原值）。 */
  readonly path: string;
  /**
   * 块内正文 —— **cards 为显示层口径（已剥行号），items/body 为 wire parity 口径（保留行号）**。
   *
   * @remarks 判据 `WORKPLACE_LINE_PREFIX`（`^\d+\|`，零前导空格），经 `Text.stripLinePrefix`
   * 逐行至多剥一次。header 档为 front-matter 行，兜底两行
   * （`（无 Front Matter）` / `（空 Front Matter）`）同形，一并剥前缀。
   * wire 侧的带行号原文在 `ctx.workplaceFiles` 与 `PromptPreviewTurn.body` 里原样保留。
   */
  readonly body: string;
  /** 展示档：full（行号全文）/ filename（单行文件名）/ header（front-matter）。 */
  readonly display: "full" | "header" | "filename";
}

/**
 * workplace 组卡：常驻工作区段拆成的文件级二级卡（数据源是 ctx 的
 * `workplaceFiles`——`assembleWorkplaceDisplay` 从 session kkv 规则快照
 * 源头顺产，不从展示串反解）。
 * 组头收起（workplace · N 文件），展开后逐文件一张小卡（路径+展示档），
 * 点文件卡看该文件块内正文全屏（用户拍板的三级结构）。
 */
export interface PromptWorkplaceCardData {
  readonly type: "workplace";
  /** 段 id（`prompt-workplace`）。 */
  readonly id: string;
  readonly files: readonly PromptWorkplaceFileCardData[];
}

/** 轮内有序卡片流。 */
export type PromptTurnCardData = PromptTextCardData | PromptToolGroupCardData | PromptWorkplaceCardData;

/**
 * 一轮提示词：合成段各占一轮，真用户输入开新轮，其余消息段归入当前 assistant 轮。
 *
 * - 合成段轮（system / skills 索引 / workplace 双段 / persist-* / dynamic-*）：
 *   **kind 用该段的真实消息 role**（system 段=system、skills/workplace=user、
 *   workplace·done=assistant、persist 按块自身 role）——不设 template 特殊分类
 *   （用户拍板：轮卡徽标统一 user/assistant/system 消息标记，不特殊区分
 *   workplace/persist），每轮一段；
 * - `user` 轮：一条真用户输入消息的全部段（至少一段，无空轮）；
 * - `assistant` 轮：紧跟其后的 assistant 文本 / thinking / tool_call / tool 段，正文在 `body` 一份字符串里。
 *
 * `items` / `summary` / `body` 是 CLI parity 冻结面（**段集合、段序、正文一字不动**）；
 * `cards` / `summaryText` / `metaText` 是渲染层旁路：由 `ctx.messages` 的 content blocks
 * 重建出结构化卡片流（工具调用一对一组卡），承载新 UI 的就地展开与全屏。
 */
export interface PromptPreviewTurn {
  readonly id: string;
  readonly kind: "system" | "user" | "assistant";
  /** CLI parity 冻结面：合成段各占一轮，段 body **一字不动**（**保留行号**）。 */
  readonly items: PromptPreviewSegment[];
  readonly summary: string;
  /** CLI parity 冻结面：`items` 段正文拼接，**保留行号**（wire 口径）。 */
  readonly body: string;
  /**
   * 有序卡片流（就地展开与全屏的渲染源），顺序=消息块序重建的因果序，与 `items` 段序无关。
   *
   * @remarks **显示层口径：workplace / tool result / user 附件的行号已剥**；
   * 与 `items` / `.body` 的 wire parity 口径刻意不同（见模块头「行号口径」段）。
   */
  readonly cards: ReadonlyArray<PromptTurnCardData>;
  /** 真摘要：单行语义（>70 字截断，三类轮统一；原文 string 或 descriptor）。 */
  readonly summaryText: MessageLike;
  /** 计数行各段（字数 / 工具调用次数 / 失败丢失计数 / 附件计数），消费方翻译后以 ` · ` join。 */
  readonly metaText: readonly MessageLike[];
}

/** 轮摘要文本位上限：首行**超** 70 字才截断（恰好 70 字原样保留）。 */
const TURN_SUMMARY_TEXT_LIMIT = 70;

/** 首条 assistant 文本的首行；超上限截断为 `slice(0, 69) + "…"`。 */
function summarizeFirstLine(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  const trimmed = firstLine.trim();
  return trimmed.length > TURN_SUMMARY_TEXT_LIMIT ? `${trimmed.slice(0, TURN_SUMMARY_TEXT_LIMIT - 1)}…` : trimmed;
}

/** 空摘要兜底文案（user 轮内层解析为空串时用；descriptor，UI 翻译）。 */
const EMPTY_SUMMARY_TEXT = { key: "label.prompt_preview.empty_text" } as const;

/** `<user-input>` / `</user-input>` 标签（wrap 形态由 `wrapUserMessageForLlm` 产出）。 */
const USER_INPUT_OPEN = "<user-input>";
const USER_INPUT_CLOSE = "</user-input>";

/** 单块的纯文本（复用 `MessageBodyText.fromBlocks` 的清洗口径：剥离孤立闭合思考标签）。 */
function blockTextForCard(block: ContentBlock): string | null {
  if (block.type !== "text" && block.type !== "image") {
    return null;
  }
  const text = MessageBodyText.fromBlocks([block]);
  return text === "" ? null : text;
}

/**
 * workplace 行的行号前缀：`^\d+\|`（零前导空格）。
 *
 * @remarks 判据零前导空格是刻意收窄的：`workplace-display.ts` 的 `${idx+1}|` /
 * filename 档 `1|basename` / header 档兜底 `1|（无 Front Matter）` 都是零空格形态。
 * 原文自身以 `数字|` 开头的行（如 `12|2024|年报`）只剥外层一次即逐字还原——
 * 正则 `^\d+\|` 锚定行首且单次替换，`1|12|34` → `12|34` 而非继续吃掉内层。
 */
const WORKPLACE_LINE_PREFIX = /^\d+\|/;

/**
 * tool result 行的行号前缀：`^ +\d+\|`（**至少 1 个前导空格**）。
 *
 * @remarks read / skill load 用 `String(n).padStart(6, " ")` 右对齐
 * （`format-tool-output.ts` 的 `formatLineNumber`），行号 < 100000 时**必有前导空格**；
 * 「至少一空格」的判据把「普通文本恰好以 `数字|` 开头」的误伤面压到近零。
 * 追加行（`Output truncated.` / `续读请用 skill read 的 offset/limit。` / 附属文件清单）
 * 无行号，自然保留。
 *
 * @remarks 已知边界：**行号 ≥ 100000 的超长文件行漏剥**（`padStart` 不再补空格，
 * 形态与 workplace 判据撞不上）——罕见，spec 已登记接受。
 */
const TOOL_RESULT_LINE_PREFIX = /^ +\d+\|/;

/**
 * user 附件 action 块（`userAttach` / `workplaceChange`）：JSON 正文在 `"content": "…"` 值内。
 *
 * @remarks 只圈这两类是因为它们的 `content` **必是** `renderFileBlockBody` 的行号正文；
 * `skillAttach` 的 `content` 是 SKILL.md 原始全文（无行号）、`annotate` 压根没有
 * `content` 键——把它们放进来就是拿行号判据去砍无行号正文，属误伤。
 */
const LINE_NUMBERED_ATTACHMENT_ACTION = /<action name="(?:userAttach|workplaceChange)">[\s\S]*?<\/action>/g;

/**
 * `"content": "…"` 三段（前缀 / 值体 / 收尾引号）。
 *
 * @remarks 值体**不含引号**——`^` 锚点必须落在值的第一个字符上，否则行首那一行永远剥不掉。
 * 转义反斜杠与引号成对，故值体用 `(?:[^"\\]|\\.)*`。
 */
const JSON_CONTENT_FIELD = /("content":\s*")((?:[^"\\]|\\.)*)(")/;

/** 转义串内的行号前缀：行首或**字面 `\n` 转义序列**（反斜杠 + n 两字符）之后，容忍空格。 */
const ESCAPED_LINE_PREFIX = /(^|\\n) *\d+\|/g;

/**
 * 剥 user 附件 JSON 转义形态的行号前缀（每处一次替换）。
 *
 * @remarks 附件正文经 `JSON.stringify(params, null, 2)` 转义后落在**单个物理行**里
 * （真换行变成 `\n` 两字符），所以逐行正则够不着——只在 `"content"` 值内匹配字面
 * `\n` 转义序列才对得上。限定在 `userAttach` / `workplaceChange` 块内是判据可用的关键：
 * 这些块的 `content` 恒为行号正文，而 dirTree（`├── …` 前缀）、binary / 超限降级
 * 文案、grep 的 `path:line:col:` 都构不成 `^ *\d+\|`，不会误伤。
 */
function stripAttachmentContentLinePrefix(text: string): string {
  if (!text.includes('"content":')) {
    return text;
  }
  return text.replace(LINE_NUMBERED_ATTACHMENT_ACTION, (block) =>
    block.replace(JSON_CONTENT_FIELD, (_field, prefix: string, value: string, tail: string) => `${prefix}${value.replace(ESCAPED_LINE_PREFIX, "$1")}${tail}`)
  );
}

/**
 * 一张消息的卡片：文本缓冲卡（`\n\n` 连接）/ thinking 卡 / 工具组卡，顺序=块序（因果序）。
 *
 * nm-style: keep-local — 纯消息投影阶段；内联会把块序合并状态（textBuffer/flushText）叠进切轮循环，
 * 使「轮切分」与「块序合并」两个不变量耦合，且与 buildUserTurnCards 的双端口径分路对应。
 */
function buildMessageCards(message: ChatMessageData, results: ReadonlyMap<string, ChatToolResultBlock>, includeThinking: boolean): PromptTurnCardData[] {
  const blocks = message.content.blocks;
  const parallel = blocks.filter((block) => block.type === "tool_use").length > 1;
  const cards: PromptTurnCardData[] = [];
  let textBuffer: Array<{ index: number; text: string }> = [];

  blocks.forEach((block, index) => {
    if (block.type === "tool_result") {
      // 结果不单独成卡：按 toolUseId 收进对应工具组卡的 result 格。
      return;
    }
    if (block.type === "tool_use") {
      const flushedCard = flushTextCard(textBuffer, (joined, first): PromptTurnCardData => ({ type: "text", id: cardId(message.id, first.index), role: message.role, body: joined }));
      if (flushedCard != null) cards.push(flushedCard);
      textBuffer = [];
      const resultBlock = results.get(block.id);
      const ok = resultBlock !== undefined && ToolResultBlock.resolveOk(resultBlock);
      const inputJson = JSON.stringify(block.input, null, 2);
      cards.push({
        type: "toolGroup",
        id: `group-${block.id}`,
        toolName: block.name,
        // 空对象退化为 CLI 同款单行头；否则美化 JSON。
        inputJson: inputJson === "{}" ? `[tool_use name=${block.name} id=${block.id}]` : inputJson,
        result:
          resultBlock === undefined
            ? null
            : {
                toolUseId: resultBlock.toolUseId,
                ok,
                // cards 是显示层口径 → 剥行号；同源 wire 正文在 items/body 段原样保留。
                body: Text.stripLinePrefix(ToolOutput.formatContentForDisplay(resultBlock.content), TOOL_RESULT_LINE_PREFIX),
              },
        status: resultBlock === undefined ? "lost" : ok ? "ok" : "error",
        parallel,
      });
      return;
    }
    if (block.type === "thinking" || block.type === "redacted_thinking") {
      if (!includeThinking) {
        return;
      }
      const flushedCard = flushTextCard(textBuffer, (joined, first): PromptTurnCardData => ({ type: "text", id: cardId(message.id, first.index), role: message.role, body: joined }));
      if (flushedCard != null) cards.push(flushedCard);
      textBuffer = [];
      cards.push({
        type: "thinking",
        id: cardId(message.id, index),
        role: message.role,
        body: block.type === "thinking" ? block.text : "[redacted thinking]",
      });
      return;
    }
    const text = blockTextForCard(block);
    if (text != null) {
      textBuffer.push({ index, text });
    }
  });
  const tailCard = flushTextCard(textBuffer, (joined, first): PromptTurnCardData => ({ type: "text", id: cardId(message.id, first.index), role: message.role, body: joined }));
  if (tailCard != null) cards.push(tailCard);
  textBuffer = [];

  return cards;
}

/**
 * user 轮卡片：wrap 后的整条文本（发给模型的形态）直转一张 text 卡。
 *
 * @remarks 卡片正文是显示层口径：附件 action 块里 `"content"` 值内的转义行号会被剥掉
 * （见 {@link stripAttachmentContentLinePrefix}）。`<user-input>` 内层与摘要取值
 * 不受影响——附件块整体在 `<user-input>` 之外。
 * nm-style: keep-local — user turn 纯消息投影阶段（附件转义行号剥离只在此路径，避免误伤正文），
 * 与 buildMessageCards 的双端口径分路对应。
 */
function buildUserTurnCards(message: ChatMessageData): PromptTurnCardData[] {
  const blocks = message.content.blocks;
  const parts: Array<{ index: number; text: string }> = [];
  blocks.forEach((block, index) => {
    const text = blockTextForCard(block);
    if (text != null) {
      parts.push({ index, text });
    }
  });
  if (parts.length === 0) {
    return [];
  }
  const first = parts[0]!;
  return [
    {
      type: "text",
      id: cardId(message.id, first.index),
      role: message.role,
      body: stripAttachmentContentLinePrefix(parts.map((part) => part.text).join("\n\n")),
    },
  ];
}

/** 卡片 id 独立命名空间（与段 id `chat-<mid>-<全局K>` 无对应关系，仅要求轮内唯一）。 */
function cardId(messageId: string, blockIndex: number): string {
  return `card-${messageId}-${blockIndex}`;
}

/** 一轮全部卡片的字数之和（三类轮的 metaText 共用同一口径）：文本/thinking 取 `body`；工具组卡取 use 输入 + result 正文；workplace 取各文件块内正文之和。 */
function cardCharsOf(cards: readonly PromptTurnCardData[]): number {
  return cards.reduce((sum, card) => {
    if (card.type === "toolGroup") {
      return sum + card.inputJson.length + (card.result?.body.length ?? 0);
    }
    if (card.type === "workplace") {
      return sum + card.files.reduce((fileSum, file) => fileSum + file.body.length, 0);
    }
    return sum + card.body.length;
  }, 0);
}

/** 分组中间形态：先按切轮规则归组，最后一步才补 summary / body / cards / 新摘要字段。 */
interface TurnGroup {
  readonly kind: PromptPreviewTurn["kind"];
  /** 来源 ChatMessageData id（user 组用于判断是否同一条消息的多段）。 */
  readonly messageId: string | undefined;
  /** 来源 ChatMessageData seq：message 段入组时取首段的 seq，合成段轮无此值。 */
  readonly seq?: number;
  readonly items: PromptPreviewSegment[];
  /** 结构化卡片流（从 ctx.messages 的 blocks 重建，与 items 段序无关）。 */
  cards: PromptTurnCardData[];
  /** 已并入 cards 的消息 id：同一条消息的多个段只贡献一次卡片。 */
  readonly consumedMessageIds: Set<string>;
  /** user 轮附件计数（含 workplace 源附件）。 */
  attachmentCount: number;
}

/** 新开一轮分组并 push 进 groups（current 组复用 vs 新开组的判据留在调用点）。 */
const pushTurnGroup = (groups: TurnGroup[], kind: TurnGroup["kind"], messageId?: string, seq?: number): TurnGroup => {
  const group: TurnGroup = {
    kind,
    messageId,
    seq,
    items: [],
    cards: [],
    consumedMessageIds: new Set<string>(),
    attachmentCount: 0,
  };
  groups.push(group);
  return group;
};

/**
 * 按「模板段各自独立 / 真用户输入开新轮 / 其余归当前 assistant 轮」聚合提示词段。
 *
 * @remarks
 * 切轮判定回到 **ChatMessageData 层**：user 且不含 tool_result 才是真用户输入
 * （`ChatMessage.isUserInput()`）；含 tool_result 的 user 消息是工具结果回传，归 assistant 轮。
 * workplace / skills 合成段虽然 role 是 user，但 `source !== "message"`，天然不参与切轮。
 * hidden 消息已在 assembly 链上过滤，这里不再处理。
 */
async function buildPromptPreviewTurnsFromLayout(layout: AgentPromptLayout, ctx: PromptRenderContext, options?: PromptAssemblyOptions): Promise<Result<PromptPreviewTurn[], AppError>> {
  const assembled = await buildPromptAssemblyFromLayout(layout, ctx, options);
  if (!assembled.ok) return Result.err(assembled.error);
  const segments = assembled.value;
  const userInputMessageIds = new Set(ctx.messages.filter((message) => ChatMessage.from(message).isUserInput()).map((message) => message.id));
  // cards 旁路的两个预扫：消息 id → 消息本体（段侧 messageId 回查），以及全量 toolUseId→result 配对表。
  // hidden 消息整条跳过（与段产出侧 `continue` 同一口径）：hidden 不进提示词，
  // 它的 tool_result 不该把 use 的组卡从「lost」救成「ok」，否则会出现「段里没有、卡里有」。
  const messageById = new Map<string, ChatMessageData>();
  const toolResults = new Map<string, ChatToolResultBlock>();
  for (const message of ctx.messages) {
    messageById.set(message.id, message);
    if (message.hidden) {
      continue;
    }
    for (const block of message.content.blocks) {
      if (block.type === "tool_result") {
        toolResults.set(block.toolUseId, block);
      }
    }
  }
  const includeThinking = options?.includeThinkingBlocks === true;

  const groups: TurnGroup[] = [];
  let current: TurnGroup | null = null;

  for (const segment of segments) {
    const item: PromptPreviewSegment = { id: segment.id, role: segment.role, title: segment.title, body: segment.body };
    if (segment.source !== "message") {
      // 合成段轮：不在 ctx.messages 里，由该轮唯一段的 items 直转卡；
      // kind 取该段的真实消息 role（见接口注释——不设 template 特殊分类，非三值兜底归 system）。
      const group = pushTurnGroup(groups, segment.role === "user" || segment.role === "assistant" ? segment.role : "system");
      group.items.push(item);
      // workplace 段拆文件级组卡（数据源 = ctx.workplaceFiles，kkv 规则快照
      // 源头直通）；无结构化数据（旧调用方/空快照）退普通 text 卡。
      const workplaceFiles = segment.id === "prompt-workplace" ? ctx.workplaceFiles ?? [] : [];
      if (workplaceFiles.length > 0) {
        group.cards.push({
          type: "workplace",
          id: item.id,
          // cards 是显示层口径 → map 出**新对象**并剥行号。
          // 严禁原地 mutate：`ctx.workplaceFiles` 的 file 对象是 desktop DTO 整数组
          // 直传的源头（`handlers/prompt.ts`），改它会连 wire 侧一起污染。
          files: workplaceFiles.map((file) => ({
            ...file,
            body: Text.stripLinePrefix(file.body, WORKPLACE_LINE_PREFIX),
          })),
        });
      } else {
        group.cards.push({
          type: "text",
          id: item.id,
          role: item.title,
          body: item.body,
        });
      }
      // 合成段自成一轮，不并入前后 chat 轮：复位 current，断掉「合成段只出现在 chat 前后」的隐式假设。
      current = null;
      continue;
    }
    const isUserInput = segment.messageId != null && userInputMessageIds.has(segment.messageId);
    let target: TurnGroup;
    if (isUserInput) {
      // 同一条消息的多个段合成一轮；换一条真用户输入即开新轮。
      target = current !== null && current.kind === "user" && current.messageId === segment.messageId ? current : pushTurnGroup(groups, "user", segment.messageId, segment.seq);
    } else {
      // 会话开头无 user 前缀时，assistant 段自成首个 assistant 轮。
      target = current !== null && current.kind === "assistant" ? current : pushTurnGroup(groups, "assistant", undefined, segment.seq);
    }
    current = target;
    target.items.push(item);
    // 卡片按消息挂载：同一条消息的多个段只贡献一次卡片流（段侧 tool_result 合并段不重复产卡）。
    const messageId = segment.messageId;
    if (messageId != null && !target.consumedMessageIds.has(messageId)) {
      target.consumedMessageIds.add(messageId);
      const message = messageById.get(messageId);
      if (message !== undefined) {
        target.cards.push(...(isUserInput ? buildUserTurnCards(message) : buildMessageCards(message, toolResults, includeThinking)));
        if (isUserInput) {
          target.attachmentCount += message.attachments?.length ?? 0;
        }
      }
    }
  }

  const turns = groups.map((group) => {
    // 分派键用「有无 seq」（消息轮必有 seq）而不是 kind：合成段轮的 kind
    // 已是段的真实消息 role（可能是 user/assistant），按 kind 分派会把合成轮
    // 错带进真消息轮的摘要口径。
    // message 轮用 `turn-${seq}`（跨段稳定、与段 id 解耦）；合成段轮无 seq，沿用段 id。
    const id = group.seq != null ? `turn-${group.seq}` : group.items[0]!.id;
    const base = {
      id,
      kind: group.kind,
      items: group.items,
      body: group.items.map((item) => `[${item.title}]\n${item.body}`).join("\n\n"),
      cards: group.cards,
    };
    if (group.seq == null) {
      // 合成段轮（原 template 分支口径逐字保留）：summary / summaryText = 段标题、metaText = 字数。
      const charCount = cardCharsOf(group.cards);
      return {
        ...base,
        summary: group.items[0]!.title,
        summaryText: group.items[0]!.title,
        metaText: [{ key: "label.prompt_preview.chars", params: { count: charCount } }],
      };
    }
    if (group.kind === "assistant") {
      // 旧 summary 专用口径（CLI parity 冻结面）：首条 assistant 段首行 + 工具调用计数 + 总字符数。
      const firstText = group.items.find((item) => item.role === "assistant");
      const textPart = firstText == null ? "" : summarizeFirstLine(firstText.body);
      const toolCallCount = group.items.filter((item) => item.role === "tool_call").length;
      const itemsCharCount = group.items.reduce((sum, item) => sum + item.body.length, 0);
      const counts = `工具调用 ${toolCallCount} 次 · ${itemsCharCount} 字`;
      // 纯 thinking / 纯工具轮没有文本位，用段数占位，卡片标题不空白。
      const summary = textPart === "" ? `${group.items.length} 段 · ${counts}` : `${textPart} · ${counts}`;
      // assistant 轮真摘要：首条 assistant 文本卡首行；纯工具/纯思考轮用卡片数占位。
      const firstTextCard = group.cards.find((card): card is PromptTextCardData => card.type === "text" && card.role === "assistant");
      const cardTextPart = firstTextCard == null ? "" : summarizeFirstLine(firstTextCard.body);
      // 计数行：字数 + 工具调用次数 + 失败/丢失计数（分别计算，不切旧 summary 拼串）。
      const toolGroups = group.cards.filter((card): card is PromptToolGroupCardData => card.type === "toolGroup");
      const metaText: MessageLike[] = [
        `#${group.seq}`,
        { key: "label.prompt_preview.tool_calls", params: { count: toolGroups.length } },
        { key: "label.prompt_preview.chars", params: { count: cardCharsOf(group.cards) } },
      ];
      const failed = toolGroups.filter((card) => card.status === "error").length;
      const lost = toolGroups.filter((card) => card.status === "lost").length;
      if (failed > 0) {
        metaText.push({ key: "label.prompt_preview.failed", params: { count: failed } });
      }
      if (lost > 0) {
        metaText.push({ key: "label.prompt_preview.lost", params: { count: lost } });
      }
      return {
        ...base,
        summary,
        summaryText: cardTextPart === "" ? { key: "label.prompt_preview.segments", params: { count: group.cards.length } } : cardTextPart,
        metaText,
      };
    }
    const firstCard = group.cards[0];
    const charCount = cardCharsOf(group.cards);
    // user 轮真摘要：<user-input> 内层首行（无标签时取正文首行）；空串兜底 `（无文本）`。
    let userSummary: MessageLike = EMPTY_SUMMARY_TEXT;
    if (firstCard != null && firstCard.type === "text") {
      // 取 `<user-input>…</user-input>` 内层原文；无该标签（未 wrap 的裸输入）时 inner = null。
      // wrap 形态首尾各带一个换行，故拿到内层后先 trim 再取首行。
      const start = firstCard.body.indexOf(USER_INPUT_OPEN);
      const end = start < 0 ? -1 : firstCard.body.lastIndexOf(USER_INPUT_CLOSE);
      const inner = start < 0 || end < 0 ? null : firstCard.body.slice(start + USER_INPUT_OPEN.length, end);
      const source = (inner === null ? firstCard.body : inner).trim();
      const firstLine = source === "" ? "" : summarizeFirstLine(source);
      if (firstLine !== "") {
        userSummary = firstLine;
      }
    }
    // user 轮计数行：`#N · M 字`（有附件追加 ` · 附件 K`）。
    const metaText: MessageLike[] = [`#${group.seq}`, { key: "label.prompt_preview.chars", params: { count: charCount } }];
    if (group.attachmentCount > 0) {
      metaText.push({ key: "label.prompt_preview.attachments", params: { count: group.attachmentCount } });
    }
    return {
      ...base,
      summary: group.items[0]!.title,
      summaryText: userSummary,
      metaText,
    };
  });
  return Result.ok(turns);
}

/**
 * Prompt 组装 / LLM 输入 / 预览的统一入口（object namespace）。
 *
 * @remarks 成员名去掉函数名冗余前缀：`computeLlmExportZonesFromLayout` → `zones`、
 * `buildPromptAssemblyFromLayout` → `assemble`、`buildPromptLlmInputFromLayout` → `llmInput`、
 * `buildPromptPreviewSegmentsFromLayout` → `previewSegments`、
 * `formatPromptLlmInputForCliFromLayout` → `cliText`、`buildPromptPreviewTurnsFromLayout` → `previewTurns`。
 */
export const PromptBuilder = {
  /** 计算 `llmInput` 输出 messages 的三区边界（纯计算）。 */
  zones: computeLlmExportZonesFromLayout,
  /** 三区 layout 单次遍历（预览 / CLI 文本 / 轮聚合的共用内核）。 */
  assemble: buildPromptAssemblyFromLayout,
  /** 构建 LLM 输入（wire 形态；dynamic 宏展开失败沿 `Result.err` 回传）。 */
  llmInput: buildPromptLlmInputFromLayout,
  /** 构建有序预览分段（每段一张卡片）。 */
  previewSegments: buildPromptPreviewSegmentsFromLayout,
  /** CLI 预览与 token 计数用的 role 前缀纯文本。 */
  cliText: formatPromptLlmInputForCliFromLayout,
  /** 按「模板段各自独立 / 真用户输入开新轮 / 其余归当前 assistant 轮」聚合预览轮。 */
  previewTurns: buildPromptPreviewTurnsFromLayout,
} as const;
