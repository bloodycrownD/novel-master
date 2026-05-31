/**
 * Regex rule draft validation and single-rule preview (aligned with examples/mobile).
 */

export type RegexChannel = 'llm' | 'display';

export interface RegexRuleDraftFields {
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly enabled: boolean;
  readonly llmReplace: string | null;
  readonly displayReplace: string | null;
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly scopeUser: boolean;
  readonly scopeAssistant: boolean;
}

export interface RegexPreviewContext {
  readonly text: string;
  readonly channel: RegexChannel;
  readonly floor: number;
  readonly role: string;
}

interface CompiledRule {
  readonly pattern: RegExp;
  readonly llmReplace: string | null;
  readonly displayReplace: string | null;
  readonly minDepth: number;
  readonly maxDepth: number;
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

function depthInRange(floor: number, rule: CompiledRule): boolean {
  return floor >= rule.minDepth && floor <= rule.maxDepth;
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
    if (!depthInRange(ctx.floor, rule)) {
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
  if (fields.minDepth > fields.maxDepth) {
    return {
      ok: false,
      message: `minDepth (${fields.minDepth}) 必须 <= maxDepth (${fields.maxDepth})`,
    };
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
        minDepth: fields.minDepth,
        maxDepth: fields.maxDepth,
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

/** Preview role from rule scope checkboxes (not a separate test control). */
export function regexPreviewRoleFromScope(
  fields: Pick<RegexRuleDraftFields, 'scopeUser' | 'scopeAssistant'>,
): string {
  if (fields.scopeAssistant && !fields.scopeUser) {
    return 'assistant';
  }
  return 'user';
}
