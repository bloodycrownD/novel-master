import {parseFrontMatterFields} from '../src/components/vfs/front-matter-fields';

describe('parseFrontMatterFields', () => {
  it('parses key value pairs', () => {
    expect(
      parseFrontMatterFields(['title: Hello', 'tags: a, b']),
    ).toEqual([
      {key: 'title', value: 'Hello'},
      {key: 'tags', value: 'a, b'},
    ]);
  });

  it('skips comments and blank lines', () => {
    expect(parseFrontMatterFields(['', '# note', 'x: 1'])).toEqual([
      {key: 'x', value: '1'},
    ]);
  });
});
