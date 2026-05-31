import {materializeInlineColors} from '../src/components/rich-content/materialize-inline-colors';
import {prepareRichHtml} from '../src/components/rich-content/prepare-rich-html';

describe('materializeInlineColors', () => {
  it('maps span color to classesStyles', () => {
    const classesStyles = {};
    const html = materializeInlineColors(
      "<span style='color:red'>hi</span>",
      classesStyles,
    );
    expect(html).toContain('class="nm-inline-c-0"');
    expect(html).not.toMatch(/color:\s*red/i);
    expect(classesStyles).toEqual({'nm-inline-c-0': {color: 'red'}});
  });

  it('reuses class for identical colors', () => {
    const classesStyles = {};
    const html = materializeInlineColors(
      "<span style='color:red'>a</span><span style=\"color:red\">b</span>",
      classesStyles,
    );
    expect(html.match(/nm-inline-c-0/g)?.length).toBe(2);
    expect(Object.keys(classesStyles)).toHaveLength(1);
  });
});

describe('prepareRichHtml inline color', () => {
  it('materializes lifted p color for RenderHTML classesStyles', () => {
    const {html, classesStyles} = prepareRichHtml(
      "<p style='color:red'>hi</p>33",
    );
    expect(html).toContain('nm-inline-c-0');
    expect(Object.values(classesStyles)).toContainEqual({color: 'red'});
    expect(html).toContain('hi');
  });
});
