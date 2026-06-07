/**
 * Regex rule draft validation and preview (ported from mobile).
 */
import { matchDepth, validateDepthSlice } from "@novel-master/config-forms/events";

export type RegexChannel = "llm" | "display";

export interface RegexRuleDraftFields {
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly enabled: boolean;
  readonly llmReplace: string | null;
  readonly displayReplace: string | null;
  readonly startDepth: number | null;
  readonly endDepth: number | null;
  readonly scopeUser: boolean;
  readonly scopeAssistant: boolean;
}

export interface RegexPreviewContext {
  readonly text: string;
  readonly channel: RegexChannel;
  readonly depthFromTail: number;
  readonly role: string;
}

interface CompiledRule {
  readonly pattern: RegExp;
  readonly llmReplace: string | null;
  readonly displayReplace: string | null;
  readonly startDepth: number | null;
  readonly endDepth: number | null;
  readonly scopeUser: boolean;
  readonly scopeAssistant: boolean;
}

type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

function roleMatchesScope(role: string, rule: CompiledRule): boolean {
  if (role === "user") return rule.scopeUser;
  if (role === "assistant") return rule.scopeAssistant;
  return false;
}

function depthInRange(depthFromTail: number, rule: CompiledRule): boolean {
  return matchDepth(depthFromTail, {
    startDepth: rule.startDepth ?? undefined,
    endDepth: rule.endDepth ?? undefined,
  });
}

function replaceForChannel(text: string, rule: CompiledRule, channel: RegexChannel): string {
  const replacement = channel === "llm" ? rule.llmReplace : rule.displayReplace;
  if (replacement == null) return text;
  return text.replace(rule.pattern, replacement);
}

function applyRegexRules(
  text: string,
  rules: readonly CompiledRule[],
  ctx: RegexPreviewContext,
): string {
  let out = text;
  for (const rule of rules) {
    if (!roleMatchesScope(ctx.role, rule)) continue;
    if (!depthInRange(ctx.depthFromTail, rule)) continue;
    out = replaceForChannel(out, rule, ctx.channel);
  }
  return out;
}

export function validateRegexRuleDraft(fields: RegexRuleDraftFields): ValidationResult {
  const hasLlm = fields.llmReplace != null && fields.llmReplace !== "";
  const hasDisplay = fields.displayReplace != null && fields.displayReplace !== "";
  if (!hasLlm && !hasDisplay) {
    return { ok: false, message: "至少启用「提示词替换」或「显示替换」之一" };
  }
  if (!fields.scopeUser && !fields.scopeAssistant) {
    return { ok: false, message: "至少选择「用户消息」或「助手消息」之一" };
  }
  try {
    validateDepthSlice({
      startDepth: fields.startDepth ?? undefined,
      endDepth: fields.endDepth ?? undefined,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, message: msg };
  }
  try {
    // eslint-disable-next-line no-new
    new RegExp(fields.pattern, fields.flags || "");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `无效的正则表达式: ${msg}` };
  }
  return { ok: true };
}

export function compileRegexRuleDraft(
  fields: RegexRuleDraftFields,
): { ok: true; compiled: CompiledRule } | { ok: false; message: string } {
  const validation = validateRegexRuleDraft(fields);
  if (!validation.ok) return validation;
  try {
    const pattern = new RegExp(fields.pattern, fields.flags || "");
    return {
      ok: true,
      compiled: {
        pattern,
        llmReplace: fields.llmReplace,
        displayReplace: fields.displayReplace,
        startDepth: fields.startDepth,
        endDepth: fields.endDepth,
        scopeUser: fields.scopeUser,
        scopeAssistant: fields.scopeAssistant,
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `无效的正则表达式: ${msg}` };
  }
}

export function previewRegexRule(
  text: string,
  draftFields: RegexRuleDraftFields,
  ctx: RegexPreviewContext,
): { ok: true; text: string } | { ok: false; message: string } {
  if (!draftFields.enabled) return { ok: true, text };
  const compiled = compileRegexRuleDraft(draftFields);
  if (!compiled.ok) return compiled;
  return { ok: true, text: applyRegexRules(text, [compiled.compiled], ctx) };
}

export function parseOptionalDepthInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Omit null depth fields before IPC — Zod expects undefined, not null. */
export function regexRuleForIpc(fields: RegexRuleDraftFields) {
  return {
    ...fields,
    startDepth: fields.startDepth ?? undefined,
    endDepth: fields.endDepth ?? undefined,
  };
}
