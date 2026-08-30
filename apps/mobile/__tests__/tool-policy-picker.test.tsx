/**
 * ToolPolicyPicker（mobile）测试：T-P1 / T-P2 / T-P3。
 *
 * - T-P1：trigger 文案反映选择数量；点开 sheet → 勾选 → 确定 → onChange 收到新数组
 * - T-P2：点行只 toggle draft 不关 sheet；点取消 → onChange 不被调用
 * - T-P3：选中行有 ✓，渲染树不含 ☑/☐
 *
 * sheet 通过 FormOverlayHost 顶起，所以测试要在 FormOverlayProvider 内渲染。
 */
import React from 'react';
import {describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

// ToolPolicyPicker 的 sheet 骨架（ModalShell）内部用 useTheme 取面板背景色。
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      text: '#111',
      textSecondary: '#666',
      surface: '#fff',
      bgSecondary: '#f4f4f5',
      border: '#ddd',
      borderLight: '#eee',
      primary: '#007aff',
    },
  }),
}));

import {ToolPolicyPicker} from '@/components/agent/ToolPolicyPicker';
import {FormOverlayProvider} from '@/components/form/FormOverlayHost';

const tokens = {
  text: '#111',
  textSecondary: '#666',
  textTertiary: '#999',
  surface: '#fff',
  bgSecondary: '#f4f4f5',
  border: '#ddd',
  borderLight: '#eee',
  primary: '#007aff',
} as any;

/**
 * 收集 test instance 子树里的展示文本，但遇到带 onPress 的后代就停下不再下钻。
 * 这样每个可点击节点的文本就只含它自己直接承载的文案（trigger 不会把 sheet 里的文案也算进来）。
 */
function collectOwnText(node: any): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(collectOwnText).join('');
  }
  let out = '';
  const props = node.props;
  if (props) {
    // 字符串/数字形式的展示属性
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (
        (typeof v === 'string' || typeof v === 'number') &&
        (key === 'children' || key === 'placeholder')
      ) {
        out += String(v);
      }
    }
  }
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    // 子节点若是带 onPress 的可点击元素，跳过（避免把别的按钮文案算进来）
    if (
      child &&
      typeof child === 'object' &&
      child.props &&
      typeof child.props.onPress === 'function'
    ) {
      continue;
    }
    out += collectOwnText(child);
  }
  return out;
}

/** 找树里所有带 onPress 的节点（RN mock 下 findAllByType 不可靠，改用 predicate）。 */
function findClickable(root: any): any[] {
  return root.findAll(
    (n: any) => n.props && typeof n.props.onPress === 'function',
  );
}

/** 在可点击节点里找子树自有文案包含 text 的第一个。 */
function findPressableByChildText(root: any, text: string): any {
  return findClickable(root).find((node: any) =>
    collectOwnText(node).includes(text),
  );
}

/** 在可点击节点里找子树自有文案包含 text 的全部（行可能重复出现）。 */
function findAllPressablesByChildText(root: any, text: string): any[] {
  return findClickable(root).filter((node: any) =>
    collectOwnText(node).includes(text),
  );
}

function renderPicker(props: {
  selected: string[];
  onChange: (s: string[]) => void;
}) {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(
      <FormOverlayProvider>
        <ToolPolicyPicker
          tokens={tokens}
          selected={props.selected}
          onChange={props.onChange}
        />
      </FormOverlayProvider>,
    );
  });
  return renderer;
}

describe('ToolPolicyPicker (mobile) — T-P1/T-P2/T-P3', () => {
  it('T-P1: trigger 显示「已选工具（N/10）」；打开 sheet 勾选后确定 → onChange 收到新数组', () => {
    const onChange = jest.fn();
    const renderer = renderPicker({selected: ['read'], onChange});

    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('已选工具（1/10）');
    expect(json).toContain('▼');

    // trigger 是 trigger 样式（含 minHeight），靠文案定位
    const trigger = findPressableByChildText(renderer.root, '已选工具（1/10）');
    expect(trigger).toBeTruthy();
    act(() => {
      trigger.props.onPress();
    });

    // sheet 打开后渲染树应含工具名
    let after = JSON.stringify(renderer.toJSON());
    expect(after).toContain('read');
    expect(after).toContain('write');

    // 勾选 write 行：write 同时出现在 sheet 列表，找列表行（排除 trigger）。
    // skill 的描述文案含「write」字样，须排除，否则误中 skill 行。
    const writeRows = findAllPressablesByChildText(
      renderer.root,
      'write',
    ).filter((row: any) => !collectOwnText(row).includes('skill'));
    expect(writeRows.length).toBeGreaterThanOrEqual(1);
    act(() => {
      writeRows[writeRows.length - 1].props.onPress();
    });

    // 点确定
    const confirmBtn = findPressableByChildText(renderer.root, '确定');
    expect(confirmBtn).toBeTruthy();
    act(() => {
      confirmBtn.props.onPress();
    });

    expect(onChange).toHaveBeenCalledWith(['read', 'write']);
  });

  it('T-P2: 点行只 toggle draft 不关 sheet；点取消 → onChange 不被调用', () => {
    const onChange = jest.fn();
    const renderer = renderPicker({selected: ['read'], onChange});

    const trigger = findPressableByChildText(renderer.root, '已选工具（1/10）');
    act(() => {
      trigger.props.onPress();
    });

    // 勾选 write
    const writeRows = findAllPressablesByChildText(renderer.root, 'write');
    act(() => {
      writeRows[writeRows.length - 1].props.onPress();
    });

    // sheet 仍打开（确定按钮还在）
    expect(findPressableByChildText(renderer.root, '确定')).toBeTruthy();

    // 取消
    const cancelBtn = findPressableByChildText(renderer.root, '取消');
    act(() => {
      cancelBtn.props.onPress();
    });
    expect(onChange).not.toHaveBeenCalled();

    // 关闭后 trigger 文案仍是原值（草稿被丢弃）
    expect(JSON.stringify(renderer.toJSON())).toContain('已选工具（1/10）');
  });

  it('T-P3: 选中行有 ✓；渲染树不含 ☑ / ☐ 字符', () => {
    const onChange = jest.fn();
    const renderer = renderPicker({selected: ['read'], onChange});

    const trigger = findPressableByChildText(renderer.root, '已选工具（1/10）');
    act(() => {
      trigger.props.onPress();
    });

    const json = JSON.stringify(renderer.toJSON());
    // 废弃的 Unicode 勾选字符必须不存在
    expect(json).not.toContain('☑');
    expect(json).not.toContain('☐');
    // read 被选中，应有 ✓
    expect(json).toContain('✓');
  });

  it('trigger 文案边界：未选择显示「未选择工具」，全选显示「全部工具」', () => {
    let r1: any;
    act(() => {
      r1 = TestRenderer.create(
        <FormOverlayProvider>
          <ToolPolicyPicker
            tokens={tokens}
            selected={[]}
            onChange={jest.fn()}
          />
        </FormOverlayProvider>,
      );
    });
    expect(JSON.stringify(r1.toJSON())).toContain('未选择工具（0/10）');

    const all = [
      'task',
      'read',
      'write',
      'edit',
      'fs',
      'glob',
      'grep',
      'skill',
      'agent',
      'curl',
    ];
    let r2: any;
    act(() => {
      r2 = TestRenderer.create(
        <FormOverlayProvider>
          <ToolPolicyPicker
            tokens={tokens}
            selected={all}
            onChange={jest.fn()}
          />
        </FormOverlayProvider>,
      );
    });
    expect(JSON.stringify(r2.toJSON())).toContain('全部工具（10/10）');
  });
});

describe('ToolPolicyPicker (mobile) — C-1 键盘避让接线（行为断言）', () => {
  it('ModalShell 接 adaptive 策略并传 iosTranslateY: true（FormOverlayHost 无 KAV 外壳，iOS 由面板自身位移）', () => {
    const renderer = renderPicker({selected: [], onChange: jest.fn()});

    // 打开 sheet：ModalShell 由 overlay.show 挂载，靠 keyboardAvoid prop 定位
    const trigger = findPressableByChildText(
      renderer.root,
      '未选择工具（0/10）',
    );
    expect(trigger).toBeTruthy();
    act(() => {
      trigger.props.onPress();
    });

    const shells = renderer.root.findAll(
      (n: {props?: {keyboardAvoid?: unknown}}) =>
        n.props != null && n.props.keyboardAvoid != null,
    );
    expect(shells.length).toBeGreaterThanOrEqual(1);
    expect(shells[0].props.keyboardAvoid).toEqual({
      kind: 'adaptive',
      maxHeightRatio: 0.75,
      iosTranslateY: true,
    });
    // FormOverlayHost 场景下必须 standalone（不包 AppModal/KAV 外壳）
    expect(shells[0].props.standalone).toBe(true);
  });
});
