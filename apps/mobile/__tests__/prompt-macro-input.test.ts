import {
  insertTextAtSelection,
  splitPromptMacroSegments,
} from '../src/components/agent/prompt-macro-input';

describe('splitPromptMacroSegments', () => {
  it('splits macros from plain text', () => {
    expect(
      splitPromptMacroSegments('hi {{.worktree}} there {{$time}}'),
    ).toEqual([
      {kind: 'text', value: 'hi '},
      {kind: 'macro', value: '{{.worktree}}'},
      {kind: 'text', value: ' there '},
      {kind: 'macro', value: '{{$time}}'},
    ]);
  });
});

describe('insertTextAtSelection', () => {
  it('inserts at cursor', () => {
    const result = insertTextAtSelection('ab', {start: 1, end: 1}, '{{$time}}');
    expect(result.next).toBe('a{{$time}}b');
    expect(result.selection).toEqual({start: 10, end: 10});
  });
});
