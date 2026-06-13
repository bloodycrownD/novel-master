/**
 * Regex rule draft validation and single-rule preview (aligned with Core applyRegexRules).
 */

import {matchDepth, validateDepthSlice} from '@novel-master/core';

export type RegexChannel = 'llm' | 'display';

export interface RegexRuleDraftFields {
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly enabled: boolean;
  readonly llmReplace: string | null;
  readonly displayReplace: string | null;
  /** Tail depth (0 = newest visible message); null = unbounded on that side. */
  readonly startDepth: number | null;
  readonly endDepth: number | null;
  readonly scopeUser: boolean;
  readonly scopeAssistant: boolean;
}

export interface RegexPreviewContext {
  readonly text: string;
  readonly channel: RegexChannel;
  /** 0-based depth from newest visible message (matches Core regex apply). */
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

type ValidationResult = {readonly ok: true} | {readonly ok: false; readonly message: string};

function roleMatchesScope(role: string, rule: CompiledRule): boolean {
  if (role === 'user') {
    return rule.scopeUser;
  }
  if (role === 'assistant') {
    return rule.scopeAssistant;
  }
  return false;
}

function depthInRange(depthFromTail: number, rule: CompiledRule): boolean {
  return matchDepth(depthFromTail, {
    startDepth: rule.startDepth ?? undefined,
    endDepth: rule.endDepth ?? undefined,
  });
}

function replaceForChannel(
  text: string,
  rule: CompiledRule,
  channel: RegexChannel,
): string {
  const replacement =
    channel === 'llm' ? rule.llmReplace : rule.displayReplace;
  if (replacement == null) {
    return text;
  }
  return text.replace(rule.pattern, replacement);
}

/** Sequential apply; skip rules outside role/depth (Core applyRegexRules). */
function applyRegexRules(
  text: string,
  rules: readonly CompiledRule[],
  ctx: RegexPreviewContext,
): string {
  let out = text;
  for (const rule of rules) {
    if (!roleMatchesScope(ctx.role, rule)) {
      continue;
    }
    if (!depthInRange(ctx.depthFromTail, rule)) {
      continue;
    }
    out = replaceForChannel(out, rule, ctx.channel);
  }
  return out;
}

/** Validates draft fields before compile/persist (browser-friendly, no throw). */
export function validateRegexRuleDraft(
  fields: RegexRuleDraftFields,
): ValidationResult {
  const hasLlm = fields.llmReplace != null && fields.llmReplace !== '';
  const hasDisplay =
    fields.displayReplace != null && fields.displayReplace !== '';
  if (!hasLlm && !hasDisplay) {
    return {ok: false, message: '至少配置 llmReplace 或 displayReplace 之一'};
  }
  if (!fields.scopeUser && !fields.scopeAssistant) {
    return {ok: false, message: '至少选择 user 或 assistant 作用范围之一'};
  }
  try {
    validateDepthSlice({
      startDepth: fields.startDepth ?? undefined,
      endDepth: fields.endDepth ?? undefined,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {ok: false, message: msg};
  }
  try {
    // eslint-disable-next-line no-new
    new RegExp(fields.pattern, fields.flags || '');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {ok: false, message: `无效的正则表达式: ${msg}`};
  }
  return {ok: true};
}

type CompileResult =
  | {readonly ok: true; readonly compiled: CompiledRule}
  | {readonly ok: false; readonly message: string};

/** Compiles draft fields into a runtime rule for preview. */
export function compileRegexRuleDraft(fields: RegexRuleDraftFields): CompileResult {
  const validation = validateRegexRuleDraft(fields);
  if (!validation.ok) {
    return validation;
  }
  try {
    const pattern = new RegExp(fields.pattern, fields.flags || '');
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
    return {ok: false, message: `无效的正则表达式: ${msg}`};
  }
}

type PreviewResult =
  | {readonly ok: true; readonly text: string}
  | {readonly ok: false; readonly message: string};

/** Single-rule test preview (nm regex test semantics). */
export function previewRegexRule(
  text: string,
  draftFields: RegexRuleDraftFields,
  ctx: RegexPreviewContext,
): PreviewResult {
  if (!draftFields.enabled) {
    return {ok: true, text};
  }
  const compiled = compileRegexRuleDraft(draftFields);
  if (!compiled.ok) {
    return compiled;
  }
  return {
    ok: true,
    text: applyRegexRules(text, [compiled.compiled], ctx),
  };
}

/** 样例文本试跑：仅 pattern + 所选通道 replace，不校验 depth/role。 */
export function previewRegexReplacementOnly(
  text: string,
  draftFields: RegexRuleDraftFields,
  channel: RegexChannel,
): PreviewResult {
  if (!draftFields.enabled) {
    return {ok: true, text};
  }
  if (!draftFields.pattern.trim()) {
    return {ok: false, message: '请填写正则表达式'};
  }
  const replacement =
    channel === 'llm' ? draftFields.llmReplace : draftFields.displayReplace;
  if (replacement == null || replacement === '') {
    return {
      ok: false,
      message:
        channel === 'llm'
          ? '请先启用并填写提示词替换'
          : '请先启用并填写显示替换',
    };
  }
  try {
    const pattern = new RegExp(draftFields.pattern, draftFields.flags || '');
    return {ok: true, text: text.replace(pattern, replacement)};
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {ok: false, message: `无效的正则表达式: ${msg}`};
  }
}

/** Preview role from rule scope checkboxes (not a separate test control). */
export function regexPreviewRoleFromScope(
  fields: Pick<RegexRuleDraftFields, 'scopeUser' | 'scopeAssistant'>,
): string {
  if (fields.scopeAssistant && !fields.scopeUser) {
    return 'assistant';
  }
  return 'user';
}

/** Parses optional non-negative depth bound from form text (empty = null). */
export function parseOptionalDepthInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return n;
}
