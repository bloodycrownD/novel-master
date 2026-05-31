import {
  extractStyleBlocksFromHtml,
  parseSimpleCssToClasses,
} from '../src/components/rich-content/extract-style-classes';

describe('extract-style-classes', () => {
  it('parses simple class rules', () => {
    const classes = parseSimpleCssToClasses('.note { color: red; font-weight: bold; }');
    expect(classes.note).toMatchObject({color: 'red', fontWeight: 'bold'});
  });

  it('removes style tags and returns classesStyles', () => {
    const {htmlWithoutStyle, classesStyles} = extractStyleBlocksFromHtml(
      '<style>.note { color: blue; }</style><p class="note">hi</p>',
    );
    expect(htmlWithoutStyle).not.toMatch(/<style/i);
    expect(htmlWithoutStyle).toContain('class="note"');
    expect(classesStyles.note).toMatchObject({color: 'blue'});
  });
});
