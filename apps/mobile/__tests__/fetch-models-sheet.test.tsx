/**
 * FetchModelsSheet（mobile）过滤测试：T-FM1 / T-FM2 / T-FM3 / T-FM4。
 *
 * - T-FM1：输入即过滤（大小写混合命中 displayName / vendorModelId）
 * - T-FM2：过滤无命中显示「无匹配模型」（区别于「未拉取到可用模型」），清空恢复全量
 * - T-FM3：过滤只作用展示——隐藏已添加行后添加他行、清空后已添加态共存不丢
 * - T-FM4：关闭再打开 Sheet，过滤词重置为空
 *
 * 照 tool-policy-picker.test.tsx 的 TestRenderer 直测风格；
 * runtime.providerModels 用 jest.mock 替换，AppModal 只在 visible 时渲染 children。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      bgSecondary: '#eee',
      surface: '#f8f8f8',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ccc',
      borderLight: '#e0e0e0',
      primary: '#007aff',
      danger: '#f00',
    },
  }),
}));

jest.mock('../src/components/ui/AppModal', () => {
  const mockReact = require('react');
  return {
    AppModal: ({children, visible}: {children?: React.ReactNode; visible?: boolean}) =>
      visible ? mockReact.createElement('View', {testID: 'app-modal'}, children) : null,
  };
});

const mockProviderModels = {
  fetch: jest.fn(),
  suggestList: jest.fn(),
  save: jest.fn(),
};

const mockRuntime = {providerModels: mockProviderModels};

jest.mock('../src/hooks/useRuntime', () => ({
  // 返回固定引用：runtime 每次渲染都是新对象的话，load 的 useCallback 会重建，
  // visible effect 就会无限重跑（Maximum update depth）。
  useRuntime: () => mockRuntime,
}));

import {FetchModelsSheet} from '../src/components/provider/FetchModelsSheet';

const SUGGESTIONS = [
  {vendorModelId: 'gpt-4o', displayName: 'GPT-4o 对话', stale: false},
  {vendorModelId: 'claude-3-sonnet', displayName: 'Claude 3 Sonnet', stale: false},
  {vendorModelId: 'ernie-speed', displayName: null, stale: false},
];

/** 渲染 Sheet 并等 load() 的 promise 落定（fetch + suggestList 都是 async）。 */
async function renderSheet(
  props: Partial<React.ComponentProps<typeof FetchModelsSheet>> = {},
) {
  const onClose = jest.fn();
  const onSaved = jest.fn();
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <FetchModelsSheet
        visible
        providerId="p1"
        onClose={onClose}
        onSaved={onSaved}
        {...props}
      />,
    );
  });
  return {renderer: renderer!, onClose, onSaved};
}

/** 找过滤输入框（树里唯一挂 onChangeText 的 TextInput）。 */
function findFilterInput(root: TestRenderer.ReactTestInstance) {
  const inputs = root.findAll(
    n => typeof n.props.onChangeText === 'function',
  );
  expect(inputs.length).toBeGreaterThanOrEqual(1);
  return inputs[0];
}

/** 输入过滤词。 */
function typeQuery(root: TestRenderer.ReactTestInstance, text: string) {
  act(() => {
    findFilterInput(root).props.onChangeText(text);
  });
}

/** 找子树自有文案包含 text 的可点击节点（照 tool-policy-picker 的做法）。 */
function findClickableByText(
  root: TestRenderer.ReactTestInstance,
  text: string,
): TestRenderer.ReactTestInstance | undefined {
  const collect = (node: any): string => {
    if (node == null) {
      return '';
    }
    if (typeof node === 'string' || typeof node === 'number') {
      return String(node);
    }
    if (Array.isArray(node)) {
      return node.map(collect).join('');
    }
    let out = '';
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      if (
        child &&
        typeof child === 'object' &&
        child.props &&
        typeof child.props.onPress === 'function'
      ) {
        continue;
      }
      out += collect(child);
    }
    return out;
  };
  return root
    .findAll(n => n.props && typeof n.props.onPress === 'function')
    .find(node => collect(node).includes(text));
}

/** 递归收集渲染树里全部展示文本（避开 toJSON 的循环引用，VirtualizedList 内部节点会挂 fiber）。 */
function treeText(node: TestRenderer.ReactTestInstance | string | number): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  let out = '';
  for (const child of node.children) {
    out += treeText(child);
  }
  return out;
}

function json(renderer: TestRenderer.ReactTestRenderer) {
  return treeText(renderer.root);
}

describe('FetchModelsSheet 过滤 (T-FM1-4)', () => {
  beforeEach(() => {
    mockProviderModels.fetch.mockReset().mockResolvedValue(undefined);
    mockProviderModels.suggestList.mockReset().mockResolvedValue(SUGGESTIONS);
    mockProviderModels.save.mockReset().mockResolvedValue(undefined);
  });

  it('T-FM1: 输入即过滤——大小写混合命中 displayName 与 vendorModelId', async () => {
    const {renderer} = await renderSheet();
    expect(json(renderer)).toContain('GPT-4o 对话');
    expect(json(renderer)).toContain('Claude 3 Sonnet');
    expect(json(renderer)).toContain('ernie-speed');

    // 大小写混合命中 displayName（输入 gPt，命中 GPT-4o 对话）
    typeQuery(renderer.root, 'gPt');
    expect(json(renderer)).toContain('GPT-4o 对话');
    expect(json(renderer)).not.toContain('Claude 3 Sonnet');
    expect(json(renderer)).not.toContain('ernie-speed');

    // 大写输入命中小写 vendorModelId（ernie-speed 无 displayName，label 落到 id）
    typeQuery(renderer.root, 'ERNIE');
    expect(json(renderer)).toContain('ernie-speed');
    expect(json(renderer)).not.toContain('GPT-4o 对话');
  });

  it('T-FM2: 无命中显示「无匹配模型」而非「未拉取到可用模型」；清空恢复全量', async () => {
    const {renderer} = await renderSheet();

    typeQuery(renderer.root, '不存在的关键字');
    expect(json(renderer)).toContain('无匹配模型');
    expect(json(renderer)).not.toContain('未拉取到可用模型');
    expect(json(renderer)).not.toContain('GPT-4o 对话');

    // 清空恢复全量
    typeQuery(renderer.root, '');
    expect(json(renderer)).not.toContain('无匹配模型');
    expect(json(renderer)).toContain('GPT-4o 对话');
    expect(json(renderer)).toContain('Claude 3 Sonnet');
    expect(json(renderer)).toContain('ernie-speed');
  });

  it('T-FM3: 过滤隐藏已添加行后清空，已添加态与 addedIds 共存不丢', async () => {
    const {renderer, onSaved} = await renderSheet();

    // 添加 gpt-4o（逐行添加按钮，非勾选批量）
    const gptRow = findClickableByText(renderer.root, 'GPT-4o 对话');
    expect(gptRow).toBeTruthy();
    await act(async () => {
      gptRow!.props.onPress();
    });
    expect(mockProviderModels.save).toHaveBeenCalledWith(
      'p1',
      'gpt-4o',
      'GPT-4o 对话',
    );
    expect(json(renderer)).toContain('已添加');
    expect(onSaved).toHaveBeenCalledTimes(1);

    // 过滤把 gpt-4o 行藏起来，添加 claude 行——已添加状态不受过滤影响
    typeQuery(renderer.root, 'claude');
    expect(json(renderer)).not.toContain('GPT-4o');
    const claudeRow = findClickableByText(renderer.root, 'Claude 3 Sonnet');
    await act(async () => {
      claudeRow!.props.onPress();
    });

    // 清空过滤：两行都已添加，save 恰好两次，未重复保存 gpt-4o
    typeQuery(renderer.root, '');
    const savedCount = (json(renderer).match(/已添加/g) ?? []).length;
    expect(savedCount).toBe(2);
    expect(mockProviderModels.save).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it('T-FM4: 关闭再打开，过滤词重置为空、列表恢复全量', async () => {
    const {renderer, onClose, onSaved} = await renderSheet();

    typeQuery(renderer.root, 'gpt');
    expect(json(renderer)).not.toContain('Claude 3 Sonnet');
    expect(findFilterInput(renderer.root).props.value).toBe('gpt');

    // 关闭：AppModal mock 渲染 null
    await act(async () => {
      renderer.update(
        <FetchModelsSheet
          visible={false}
          providerId="p1"
          onClose={onClose}
          onSaved={onSaved}
        />,
      );
    });
    expect(json(renderer)).not.toContain('GPT-4o 对话');

    // 重新打开：visible 翻 true 的 effect 重置过滤词并重新拉取
    await act(async () => {
      renderer.update(
        <FetchModelsSheet
          visible
          providerId="p1"
          onClose={onClose}
          onSaved={onSaved}
        />,
      );
    });
    expect(findFilterInput(renderer.root).props.value).toBe('');
    expect(json(renderer)).toContain('GPT-4o 对话');
    expect(json(renderer)).toContain('Claude 3 Sonnet');
    expect(json(renderer)).toContain('ernie-speed');
  });
});
