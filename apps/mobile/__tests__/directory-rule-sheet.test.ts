/**
 * DirectoryRuleSheet（mobile）C-2：styles.form 键盘收缩契约（源码断言）。
 *
 * 面板 maxHeight 随键盘收缩时，超高内容要向内收缩（flexShrink: 1），
 * 否则底部按钮行（actions）会被裁出可视区——对齐 ToolPolicyPicker list 的写法。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const src = readFileSync(
  join(__dirname, '..', 'src', 'components', 'sheet', 'DirectoryRuleSheet.tsx'),
  'utf8',
);

describe('DirectoryRuleSheet (mobile) — C-2 flexShrink 契约', () => {
  it('styles.form 含 flexShrink: 1：键盘收缩时底部按钮行不被裁', () => {
    // form 是单行样式对象，正则兼顾后续往 form 里加属性的情况
    expect(src).toMatch(/form:\s*\{[^}]*flexShrink:\s*1/);
  });
});
