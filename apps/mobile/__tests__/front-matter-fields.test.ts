import {FrontMatter} from '@novel-master/core/common';

describe('FrontMatter.parseFields', () => {
  it('parses key value pairs', () => {
    expect(FrontMatter.parseFields(['title: Hello', 'tags: a, b'])).toEqual([
      {key: 'title', value: 'Hello'},
      {key: 'tags', value: 'a, b'},
    ]);
  });

  it('skips comments and blank lines', () => {
    expect(FrontMatter.parseFields(['', '# note', 'x: 1'])).toEqual([
      {key: 'x', value: '1'},
    ]);
  });
});
