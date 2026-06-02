/** Prompt template macros insertable from the Agent editor. */
export const PROMPT_INSERTABLE_MACROS = [
  {label: '.worktree', token: '{{.worktree}}'},
  {label: '.filetree', token: '{{.filetree}}'},
  {label: '$time', token: '{{$time}}'},
  {label: '$week_cn', token: '{{$week_cn}}'},
] as const;

const MACRO_PATTERN = /(\{\{[^}]+\}\})/g;

export type PromptMacroSegment =
  | {readonly kind: 'text'; readonly value: string}
  | {readonly kind: 'macro'; readonly value: string};

/** Split plain text into literal segments and `{{ ... }}` macro tokens. */
export function splitPromptMacroSegments(text: string): readonly PromptMacroSegment[] {
  if (text === '') {
    return [];
  }
  const parts = text.split(MACRO_PATTERN).filter(part => part.length > 0);
  return parts.map(part =>
    part.startsWith('{{') && part.endsWith('}}')
      ? {kind: 'macro' as const, value: part}
      : {kind: 'text' as const, value: part},
  );
}

export function insertTextAtSelection(
  value: string,
  selection: {readonly start: number; readonly end: number},
  insert: string,
): {readonly next: string; readonly selection: {readonly start: number; readonly end: number}} {
  const start = Math.max(0, Math.min(selection.start, value.length));
  const end = Math.max(start, Math.min(selection.end, value.length));
  const next = value.slice(0, start) + insert + value.slice(end);
  const cursor = start + insert.length;
  return {next, selection: {start: cursor, end: cursor}};
}
