import {
  insertTextAtSelection,
  splitPromptMacroSegments,
} from '../src/components/agent/prompt-macro-input';

describe('splitPromptMacroSegments', () => {
  it('splits dynamic macros from plain text', () => {
    expect(
      splitPromptMacroSegments('hi {{$filetree}} there {{$time}}'),
    ).toEqual([
      {kind: 'text', value: 'hi '},
      {kind: 'macro', value: '{{$filetree}}'},
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
