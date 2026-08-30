/**
 * CollapsibleSection/CollapsibleHeader class 派生契约（web/C-2 回归守护）。
 * 背景：headerClass 派生 title/chevron class 时曾错拼成 `-header-title` 加后缀，
 * CSS 选择器 .tool-group-title / .thinking-title 匹配不上，「工具调用」「思考过程」
 * 标题退化成正文样式（黑色正体）。本测试直接调用函数组件取 vnode 树，
 * 断言最终渲染 class 与 transcript.css 的选择器一一对应。
 */
import type {VNode} from 'preact';
import {
  CollapsibleHeader,
  CollapsibleSection,
} from '../src/web/chat-transcript/webview/ui/render/CollapsibleSection';

function classNames(vnode: VNode): {
  root: string;
  title: string;
  chevron: string;
} {
  const children = vnode.props.children as VNode[];
  if (!Array.isArray(children) || children.length < 2) {
    throw new Error('CollapsibleHeader 子节点结构不符合预期');
  }
  return {
    root: String(vnode.props.className),
    title: String(children[0].props.className),
    chevron: String(children[1].props.className),
  };
}

describe('CollapsibleHeader class 派生（regression: 工具调用/思考过程标题样式）', () => {
  it('tool-group-header → tool-group-title / tool-group-chevron（不加 -header- 后缀）', () => {
    const vnode = CollapsibleHeader({
      headerClass: 'tool-group-header',
      title: '工具调用 (2)',
      action: 'toggle-tool-group',
      dataKey: 'tool-group-key',
      dataValue: 'g1',
      expanded: false,
    });
    const cls = classNames(vnode);
    expect(cls.root).toBe('tool-group-header');
    expect(cls.title).toBe('tool-group-title');
    expect(cls.chevron).toBe('tool-group-chevron');
  });

  it('thinking-header → thinking-title / thinking-chevron', () => {
    const vnode = CollapsibleHeader({
      headerClass: 'thinking-header',
      title: '思考过程',
      action: 'toggle-thinking',
      dataKey: 'thinking-key',
      dataValue: 'stream:thinking',
      expanded: true,
    });
    const cls = classNames(vnode);
    expect(cls.title).toBe('thinking-title');
    expect(cls.chevron).toBe('thinking-chevron');
  });
});

describe('CollapsibleSection DOM 骨架', () => {
  it('section class = sectionClass + dividedClass，header 为 tool-group 形态', () => {
    const vnode = CollapsibleSection({
      title: '工具调用 (1)',
      action: 'toggle-tool-group',
      dataKey: 'tool-group-key',
      dataValue: 'g2',
      expanded: true,
      sectionClass: 'tool-group-section',
      dividedClass: ' tool-group-divided',
      children: null,
    });
    expect(String(vnode.props.className)).toBe(
      'tool-group-section tool-group-divided',
    );
    const headerEl = (vnode.props.children as VNode[])[0];
    // section 首子节点为 CollapsibleHeader 元素，class 由其 headerClass 决定（已由上方用例锁定）
    expect(headerEl.props.headerClass).toBe('tool-group-header');
  });
});
