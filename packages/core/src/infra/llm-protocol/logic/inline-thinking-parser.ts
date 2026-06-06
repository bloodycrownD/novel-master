import type { LlmStreamEvent } from "../ports/adapter.port.js";

/**
 * Strip inline thinking markers from model text streams.
 *
 * Some OpenAI-compatible proxies and Gemini gateways emit reasoning both as
 * structured fields (`reasoning_content`, `thought: true`) and as tagged prose
 * inside `content` / plain text parts (`<thought>`, `>thought`, HTML entities).
 *
 * @module infra/llm-protocol/logic/inline-thinking-parser
 */

/** Tag names seen on the wire (case-insensitive). */
const INLINE_THINKING_TAG_NAMES = [
  "thought",
  "thinking",
  "think",
  "redacted_thinking",
] as const;

const INLINE_THINKING_TAG_PATTERN = INLINE_THINKING_TAG_NAMES.join("|");

/** Decode entities providers sometimes emit instead of raw angle brackets. */
export function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"');
}

type SplitResult = {
  readonly thinking: string;
  readonly visible: string;
};

function joinThinkingParts(parts: readonly string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .join("\n\n");
}

function extractXmlThinkingBlocks(text: string, sink: string[]): string {
  const open = new RegExp(
    `<(${INLINE_THINKING_TAG_PATTERN})\\b[^>]*>`,
    "gi",
  );
  let out = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = open.exec(text)) !== null) {
    out += text.slice(cursor, match.index);
    const tag = match[1]!;
    const close = new RegExp(`</${tag}\\b[^>]*>`, "i");
    const bodyStart = match.index + match[0].length;
    const closeMatch = close.exec(text.slice(bodyStart));
    if (closeMatch == null) {
      // Unclosed tag: treat remainder as thinking (common on abrupt stream end).
      sink.push(text.slice(bodyStart));
      cursor = text.length;
      break;
    }
    sink.push(text.slice(bodyStart, bodyStart + closeMatch.index));
    cursor = bodyStart + closeMatch.index + closeMatch[0].length;
    open.lastIndex = cursor;
  }

  out += text.slice(cursor);
  return out;
}

function extractThinkFencedBlocks(text: string, sink: string[]): string {
  return text.replace(
    /`([\s\S]*?)`/gi,
    (_full, body: string) => {
      sink.push(body);
      return "";
    },
  );
}

const MALFORMED_THOUGHT_MARKER = /(?:^|(?<=[^\s<]))>thought\b\s*/i;

/** End thinking body before the next marker or a CJK reply paragraph. */
function findMalformedThoughtBodyEnd(text: string, bodyStart: number): number {
  const rest = text.slice(bodyStart);
  const replyBreak = /\n\n[\t ]*[\u4e00-\u9fff]/u.exec(rest);
  if (replyBreak != null && replyBreak.index > 0) {
    return bodyStart + replyBreak.index;
  }
  MALFORMED_THOUGHT_MARKER.lastIndex = bodyStart;
  const next = MALFORMED_THOUGHT_MARKER.exec(text);
  if (next != null && next.index > bodyStart) {
    return next.index;
  }
  return text.length;
}

/** Malformed `>thought` delimiter (missing `<`), including HTML-escaped `&gt;thought`. */
function extractMalformedThoughtDelimiter(text: string, sink: string[]): string {
  let out = text;
  let match = MALFORMED_THOUGHT_MARKER.exec(out);
  while (match != null) {
    const before = out.slice(0, match.index);
    const bodyStart = match.index + match[0].length;
    const bodyEnd = findMalformedThoughtBodyEnd(out, bodyStart);
    sink.push(out.slice(bodyStart, bodyEnd));
    // Prefix glued to `>thought` (e.g. story token + marker) is provider leak, not reply.
    const dropPrefix =
      before !== "" && !before.includes("\n") && match.index <= 48;
    out = (dropPrefix ? "" : before) + out.slice(bodyEnd);
    MALFORMED_THOUGHT_MARKER.lastIndex = 0;
    match = MALFORMED_THOUGHT_MARKER.exec(out);
  }
  return out;
}

/**
 * Split completed text into thinking prose vs user-visible reply.
 * Safe to call on text that has no inline markers (returns visible unchanged).
 */
export function splitInlineThinkingFromText(raw: string): SplitResult {
  if (raw.trim() === "") {
    return { thinking: "", visible: "" };
  }

  const normalized = decodeBasicHtmlEntities(raw);
  const thinkingParts: string[] = [];

  let visible = extractThinkFencedBlocks(normalized, thinkingParts);
  visible = extractXmlThinkingBlocks(visible, thinkingParts);
  visible = extractMalformedThoughtDelimiter(visible, thinkingParts);

  return {
    thinking: joinThinkingParts(thinkingParts),
    visible: visible.trim(),
  };
}

function longestSharedPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) {
    i++;
  }
  return i;
}

/**
 * Remove thinking prose duplicated in `text` when structured thinking already exists.
 * Handles overlap after inline tag stripping (Gemini + proxy double-encoding).
 */
export function stripLeakedThinkingFromText(
  text: string,
  structuredThinking: string,
): string {
  const trimmedThinking = structuredThinking.trim();
  if (text.trim() === "" || trimmedThinking === "") {
    return text;
  }

  const { visible } = splitInlineThinkingFromText(text);
  let result = visible;

  const marker = /(?:^|(?<=[^\s<]))>thought\b\s*/i;
  const markerMatch = marker.exec(result);
  if (markerMatch != null) {
    const before = result.slice(0, markerMatch.index);
    const after = result.slice(markerMatch.index + markerMatch[0].length);
    const shared = longestSharedPrefix(trimmedThinking, after);
    if (shared >= Math.min(24, trimmedThinking.length)) {
      result = before + after.slice(shared);
    } else {
      result = before + after;
    }
  }

  if (result.startsWith(trimmedThinking)) {
    result = result.slice(trimmedThinking.length);
  } else {
    const shared = longestSharedPrefix(trimmedThinking, result);
    if (shared >= Math.min(24, trimmedThinking.length, result.length)) {
      result = result.slice(shared);
    }
  }

  return result.trimStart();
}

export function mergeThinkingSegments(
  structured: string,
  inline: string,
): string {
  const a = structured.trim();
  const b = inline.trim();
  if (a === "") {
    return b;
  }
  if (b === "") {
    return a;
  }
  if (a.includes(b) || b.includes(a)) {
    return a.length >= b.length ? a : b;
  }
  return `${a}\n\n${b}`;
}

/**
 * Finalize-path sanitizer: strip inline / duplicated thinking from visible text.
 */
export function cleanseReplyTextAndThinking(
  textRaw: string,
  thinkingRaw: string,
): SplitResult {
  const inline = splitInlineThinkingFromText(textRaw);
  const mergedThinking = mergeThinkingSegments(thinkingRaw, inline.thinking);
  const visible = stripLeakedThinkingFromText(inline.visible, mergedThinking);
  return { thinking: mergedThinking, visible };
}

type StreamEmit = {
  readonly text: string;
  readonly thinking: string;
};

/**
 * Incremental splitter for text-delta chunks. Holds back suffixes that may be
 * the start of `<thought>` / `>thought` / `&lt;` so partial tags do not leak.
 */
export class InlineThinkingStreamSplitter {
  private carry = "";
  private mode: "visible" | "thinking" = "visible";
  private openTag: string | null = null;

  feed(chunk: string): StreamEmit {
    if (chunk === "") {
      return { text: "", thinking: "" };
    }

    const input = this.carry + decodeBasicHtmlEntities(chunk);
    this.carry = "";
    let textOut = "";
    let thinkingOut = "";
    let i = 0;

    const tryMatch = (re: RegExp, from: number): RegExpExecArray | null => {
      re.lastIndex = from;
      return re.exec(input);
    };

    const openXml = new RegExp(
      `<(${INLINE_THINKING_TAG_PATTERN})\\b[^>]*>`,
      "gi",
    );
    const closeXml = (tag: string) => new RegExp(`</${tag}\\b[^>]*>`, "i");
    const openThink = /`(?=[\s\S])/i;
    const closeThink = /`/;
    const openMalformed = MALFORMED_THOUGHT_MARKER;

    while (i < input.length) {
      if (this.mode === "visible") {
        const probes: Array<{ index: number; kind: "xml" | "think" | "malformed"; tag?: string }> =
          [];

        const xml = tryMatch(openXml, i);
        if (xml != null) {
          probes.push({ index: xml.index, kind: "xml", tag: xml[1]!.toLowerCase() });
        }
        const think = tryMatch(openThink, i);
        if (think != null) {
          probes.push({ index: think.index, kind: "think" });
        }
        const malformed = tryMatch(openMalformed, i);
        if (malformed != null) {
          probes.push({ index: malformed.index, kind: "malformed" });
        }

        if (probes.length === 0) {
          textOut += input.slice(i);
          i = input.length;
          break;
        }

        probes.sort((a, b) => a.index - b.index);
        const next = probes[0]!;
        const prefix = input.slice(i, next.index);
        const dropMalformedPrefix =
          next.kind === "malformed" &&
          prefix !== "" &&
          !prefix.includes("\n") &&
          prefix.length <= 48;
        if (!dropMalformedPrefix) {
          textOut += prefix;
        }

        if (next.kind === "xml" && next.tag != null) {
          const openMatch = tryMatch(openXml, next.index)!;
          this.mode = "thinking";
          this.openTag = next.tag;
          i = openMatch.index + openMatch[0].length;
          continue;
        }
        if (next.kind === "think") {
          this.mode = "thinking";
          this.openTag = "think-fence";
          i = next.index + 7; // opening ``
          continue;
        }
        const mal = tryMatch(openMalformed, next.index)!;
        this.mode = "thinking";
        this.openTag = "malformed-thought";
        i = mal.index + mal[0].length;
        continue;
      }

      // thinking mode — scan for close marker
      if (this.openTag === "think-fence") {
        closeThink.lastIndex = i;
        const end = closeThink.exec(input);
        if (end == null) {
          this.carry = input.slice(i);
          i = input.length;
          break;
        }
        thinkingOut += input.slice(i, end.index);
        this.mode = "visible";
        this.openTag = null;
        i = end.index + end[0].length;
        continue;
      }

      if (this.openTag === "malformed-thought") {
        const end = findMalformedThoughtBodyEnd(input, i);
        thinkingOut += input.slice(i, end);
        this.mode = "visible";
        this.openTag = null;
        i = end;
        continue;
      }

      if (this.openTag != null) {
        const close = closeXml(this.openTag);
        close.lastIndex = i;
        const end = close.exec(input);
        if (end == null) {
          this.carry = input.slice(i);
          i = input.length;
          break;
        }
        thinkingOut += input.slice(i, end.index);
        this.mode = "visible";
        this.openTag = null;
        i = end.index + end[0].length;
      }
    }

    if (this.mode === "visible" && textOut.length > 0) {
      const holdback = findIncompleteTagSuffix(textOut);
      if (holdback > 0) {
        this.carry = textOut.slice(-holdback);
        textOut = textOut.slice(0, -holdback);
      }
    }

    return { text: textOut, thinking: thinkingOut };
  }

  /** Flush tail at stream end; unclosed thinking blocks stay in thinking. */
  finish(): StreamEmit {
    if (this.carry === "" && this.mode === "visible") {
      return { text: "", thinking: "" };
    }
    const tail = this.carry;
    this.carry = "";
    if (this.mode === "thinking") {
      this.mode = "visible";
      this.openTag = null;
      return { text: "", thinking: tail };
    }
    return { text: tail, thinking: "" };
  }
}

/** Hold back suffix that might complete on the next chunk. */
function findIncompleteTagSuffix(text: string): number {
  const markers = ["&lt;", "&gt;", "<", ">", "`"];
  let max = 0;
  for (const marker of markers) {
    for (let len = 1; len < marker.length && len <= text.length; len++) {
      if (marker.startsWith(text.slice(-len))) {
        max = Math.max(max, len);
      }
    }
  }
  const lower = text.toLowerCase();
  const partialTags = [
    ">thought",
    "<thought",
    "<thinking",
    "<think",
    "`",
    "</thought",
    "</thinking",
  ];
  for (const tag of partialTags) {
    for (let len = 1; len < tag.length && len <= lower.length; len++) {
      if (tag.startsWith(lower.slice(-len))) {
        max = Math.max(max, len);
      }
    }
  }
  return max;
}

export type InlineThinkingStreamState = {
  readonly textParts: string[];
  readonly thinkingParts: string[];
  inlineTextSplitter?: InlineThinkingStreamSplitter;
};

function ensureSplitter(
  state: InlineThinkingStreamState,
): InlineThinkingStreamSplitter {
  if (state.inlineTextSplitter == null) {
    state.inlineTextSplitter = new InlineThinkingStreamSplitter();
  }
  return state.inlineTextSplitter;
}

/** Route a text delta; inline markers may emit thinking-delta instead of text-delta. */
export function feedInlineThinkingAwareTextDelta(
  state: InlineThinkingStreamState,
  delta: string,
  onStream?: (event: LlmStreamEvent) => void,
): void {
  if (delta === "") {
    return;
  }
  const { text, thinking } = ensureSplitter(state).feed(delta);
  if (text !== "") {
    state.textParts.push(text);
    onStream?.({ type: "text-delta", text });
  }
  if (thinking !== "") {
    state.thinkingParts.push(thinking);
    onStream?.({ type: "thinking-delta", text: thinking });
  }
}

/** Flush held-back suffix and unclosed inline thinking at stream end. */
export function finishInlineThinkingAwareText(
  state: InlineThinkingStreamState,
  onStream?: (event: LlmStreamEvent) => void,
): void {
  const splitter = state.inlineTextSplitter;
  if (splitter == null) {
    return;
  }
  const { text, thinking } = splitter.finish();
  if (text !== "") {
    state.textParts.push(text);
    onStream?.({ type: "text-delta", text });
  }
  if (thinking !== "") {
    state.thinkingParts.push(thinking);
    onStream?.({ type: "thinking-delta", text: thinking });
  }
}
