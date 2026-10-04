/**
 * T-TGO：ToolGroup「结果阅读兜底」渲染分支的产出侧守门（CR-3）。
 *
 * T-TRW1~6 全在消费侧（rows-click），T-TRB 只断言产物字符串存在——若渲染
 * 分支回退（忘输出 data-tool-use-id / 误改 hasResult 条件），那些测试照绿、
 * 真机表现为「卡片能点但没反应」。本组用例直接调用 ToolGroup 取 vnode，
 * 断言每张卡产出的 data-action 与 data-* 键（仿 collapsible-section-classes
 * .test.tsx 的 vnode 直调形态，无 jsdom）。
 */
import type {VNode} from 'preact';
import {ToolGroup} from '../src/web/chat-transcript/webview/ui/render/ToolGroup';

/**
 * 取 ToolGroup 里各工具卡 ToolGroupItem 的**执行产物** vnode。
 *
 * `tools.map` 产出的 child 是未执行的组件元素 `{type: ToolGroupItem,
 * props: {tool}}`（children 惰性）；要断言卡片真实渲染的 data-* 键须
 * 再调一层 `type(props)` 展开到 ToolGroupItem 返回的 div。
 */
function itemVNodes(tools: object[]): VNode[] {
  const section = ToolGroup({
    tools: tools as never[],
    groupKey: 'g1',
    expanded: true,
  }) as VNode;
  const children = section.props.children as VNode[];
  if (!Array.isArray(children)) {
    throw new Error('ToolGroup children 结构不符合预期');
  }
  return children.map((el) =>
    (el.type as (props: unknown) => VNode)(el.props),
  );
}

describe('ToolGroup 结果阅读兜底渲染分支 (T-TGO)', () => {
  it('T-TGO1: fs 卡（无专属跳转、有结果正文）→ data-action=open-tool-result + data-tool-use-id', () => {
    const [item] = itemVNodes([
      {toolUseId: 'tu-1', name: 'fs', input: {action: 'ls', path: '/tmp'}, resultContent: '目录列表'},
    ]);
    expect(item.props['data-action']).toBe('open-tool-result');
    expect(item.props['data-tool-use-id']).toBe('tu-1');
    expect(item.props['data-path']).toBeUndefined();
  });

  it('T-TGO2: read 卡（有 filePath）→ open-tool-file，不进兜底', () => {
    const [item] = itemVNodes([
      {toolUseId: 'tu-2', name: 'read', input: {path: '/notes/a.md'}, resultContent: '正文…'},
    ]);
    expect(item.props['data-action']).toBe('open-tool-file');
    expect(item.props['data-path']).toBe('/notes/a.md');
    expect(item.props['data-tool-use-id']).toBeUndefined();
  });

  it('T-TGO3: skill 卡（skillRef 可解析）→ open-skill，不进兜底', () => {
    const [item] = itemVNodes([
      {
        toolUseId: 'tu-3',
        name: 'skill',
        input: {action: 'write', name: '节拍成章', domain: 'global'},
        resultContent: 'ok',
      },
    ]);
    expect(item.props['data-action']).toBe('open-skill');
    expect(item.props['data-name']).toBe('节拍成章');
  });

  it('T-TGO4: content 空串/纯空白 + summary 有信息 → 仍走兜底可点（CR-1 联动）', () => {
    const [empty] = itemVNodes([
      {toolUseId: 'tu-4', name: 'fs', input: {action: 'ls', path: '/tmp'}, resultContent: '', summary: '0 entries'},
    ]);
    expect(empty.props['data-action']).toBe('open-tool-result');
    const [blank] = itemVNodes([
      {toolUseId: 'tu-5', name: 'glob', input: {pattern: '**/*.md'}, resultContent: '   ', summary: '0 paths'},
    ]);
    expect(blank.props['data-action']).toBe('open-tool-result');
  });

  it('T-TGO5: pending 卡（无 content 无 summary）→ 不可点（data-action 缺省）', () => {
    const [item] = itemVNodes([
      {toolUseId: 'tu-6', name: 'fs', input: {action: 'ls', path: '/tmp'}},
    ]);
    expect(item.props['data-action']).toBeUndefined();
  });
});
