import {liftInlineColorToInnerSpan} from '../src/components/rich-content/lift-inline-color';
import {prepareRichHtml} from '../src/components/rich-content/prepare-rich-html';

describe('liftInlineColorToInnerSpan', () => {
  it('wraps colored p content in span', () => {
    const out = liftInlineColorToInnerSpan(
      "<p style='color:red'>hi</p>",
    );
    expect(out).toMatch(/<span style=['"]color:\s*red['"]>hi<\/span>/i);
  });
});

describe('prepareRichHtml inline color', () => {
  it('lifts p color and materializes class', () => {
    const {html, classesStyles} = prepareRichHtml(
      "<p style='color:red'>hi</p>33",
    );
    expect(html).toContain('nm-inline-c-0');
    expect(Object.values(classesStyles)).toContainEqual({color: 'red'});
    expect(html).toContain('hi');
  });
});
