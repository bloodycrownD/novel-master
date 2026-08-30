/**
 * FetchModelsSheet（mobile）过滤与勾选批量测试：T-FM1 / T-FM2 / T-FM3 / T-FM4 / T-FM5 / T-FM6 / T-FM7。
 *
 * - T-FM1：输入即过滤（大小写混合命中 displayName / vendorModelId）
 * - T-FM2：过滤无命中显示「无匹配模型」（区别于「未拉取到可用模型」），清空恢复全量
 * - T-FM3：勾选 + 底部「添加 (N)」批量保存；过滤隐藏已添加行后添加他行、清空后已添加态共存不丢
 * - T-FM4：关闭再打开 Sheet，过滤词与勾选都重置
 * - T-FM5：全选/全不选作用于当前过滤后且未添加的行
 * - T-FM6：批量添加逐个保存，成功后清空勾选并标「已添加」
 * - T-FM7：保存中途失败即停止并报错，已成功行标「已添加」、失败行保留勾选
 *
 * 照 tool-policy-picker.test.tsx 的 TestRenderer 直测风格；
 * runtime.providerModels 用 jest.mock 替换，AppModal 只在 visible 时渲染 children。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

jest.mock('@/theme/ThemeProvider', () => ({
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

jest.mock('@/components/ui/AppModal', () => {
  const mockReact = require('react');
  return {
    AppModal: ({
      children,
      visible,
    }: {
      children?: React.ReactNode;
      visible?: boolean;
    }) =>
      visible
        ? mockReact.createElement('View', {testID: 'app-modal'}, children)
        : null,
  };
});

const mockProviderModels = {
  fetch: jest.fn(),
  suggestList: jest.fn(),
  save: jest.fn(),
};

const mockRuntime = {providerModels: mockProviderModels};

jest.mock('@/hooks/useRuntime', () => ({
  // 返回固定引用：runtime 每次渲染都是新对象的话，load 的 useCallback 会重建，
  // visible effect 就会无限重跑（Maximum update depth）。
  useRuntime: () => mockRuntime,
}));

import {FetchModelsSheet} from '@/components/provider/FetchModelsSheet';

const SUGGESTIONS = [
  {vendorModelId: 'gpt-4o', displayName: 'GPT-4o 对话', stale: false},
  {
    vendorModelId: 'claude-3-sonnet',
    displayName: 'Claude 3 Sonnet',
    stale: false,
  },
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
  const inputs = root.findAll(n => typeof n.props.onChangeText === 'function');
  expect(inputs.length).toBeGreaterThanOrEqual(1);
  return inputs[0];
}

/** 输入过滤词。 */
function typeQuery(root: TestRenderer.ReactTestInstance, text: string) {
  act(() => {
    findFilterInput(root).props.onChangeText(text);
  });
}

/** 收集节点子树里自有（非可点击后代）文案，避开 toJSON 循环引用。 */
function collectText(node: any): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(collectText).join('');
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
    out += collectText(child);
  }
  return out;
}

/** 找子树自有文案包含 text 的可点击节点（照 tool-policy-picker 的做法）。 */
function findClickableByText(
  root: TestRenderer.ReactTestInstance,
  text: string,
): TestRenderer.ReactTestInstance | undefined {
  return root
    .findAll(n => n.props && typeof n.props.onPress === 'function')
    .find(node => collectText(node).includes(text));
}

/** 找按钮文案精确等于 text 的可点击节点——避免 backdrop 副标题等长文本被模糊包含误中。 */
function findButtonByText(
  root: TestRenderer.ReactTestInstance,
  text: string,
): TestRenderer.ReactTestInstance | undefined {
  return root
    .findAll(n => n.props && typeof n.props.onPress === 'function')
    .find(node => collectText(node).trim() === text);
}

/** 递归收集渲染树里全部展示文本（避开 toJSON 的循环引用，VirtualizedList 内部节点会挂 fiber）。 */
function treeText(
  node: TestRenderer.ReactTestInstance | string | number,
): string {
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

  it('T-FM3: 勾选 + 批量添加；过滤隐藏已添加行后清空，已添加态共存不丢', async () => {
    const {renderer, onSaved} = await renderSheet();

    // 勾选 gpt-4o，点行即 toggle，底部按钮变「添加 (1)」，点后逐个保存
    const gptRow = findClickableByText(renderer.root, 'GPT-4o 对话');
    expect(gptRow).toBeTruthy();
    act(() => {
      gptRow!.props.onPress();
    });
    expect(json(renderer)).toContain('添加 (1)');
    await act(async () => {
      findButtonByText(renderer.root, '添加 (1)')!.props.onPress();
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
    act(() => {
      claudeRow!.props.onPress();
    });
    await act(async () => {
      findButtonByText(renderer.root, '添加 (1)')!.props.onPress();
    });

    // 清空过滤：两行都已添加，save 恰好两次，未重复保存 gpt-4o
    typeQuery(renderer.root, '');
    const savedCount = (json(renderer).match(/已添加/g) ?? []).length;
    expect(savedCount).toBe(2);
    expect(mockProviderModels.save).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it('T-FM4: 关闭再打开，过滤词与勾选都重置', async () => {
    const {renderer, onClose, onSaved} = await renderSheet();

    typeQuery(renderer.root, 'gpt');
    expect(json(renderer)).not.toContain('Claude 3 Sonnet');
    expect(findFilterInput(renderer.root).props.value).toBe('gpt');

    // 勾选一行，重开后应被重置
    act(() => {
      findClickableByText(renderer.root, 'GPT-4o 对话')!.props.onPress();
    });
    expect(json(renderer)).toContain('已选 1 项');

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

    // 重新打开：visible 翻 true 的 effect 重置过滤词与勾选并重新拉取
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
    expect(json(renderer)).toContain('已选 0 项');
    expect(json(renderer)).toContain('GPT-4o 对话');
    expect(json(renderer)).toContain('Claude 3 Sonnet');
    expect(json(renderer)).toContain('ernie-speed');
  });
});

describe('FetchModelsSheet 勾选批量与全选 (T-FM5-7)', () => {
  beforeEach(() => {
    mockProviderModels.fetch.mockReset().mockResolvedValue(undefined);
    mockProviderModels.suggestList.mockReset().mockResolvedValue(SUGGESTIONS);
    mockProviderModels.save.mockReset().mockResolvedValue(undefined);
  });

  it('T-FM5: 全选/全不选只作用于当前过滤后且未添加的行', async () => {
    const {renderer} = await renderSheet();
    expect(json(renderer)).toContain('全选');

    // 全选：3 行全勾，按钮翻「全不选」，计数与确认按钮文案同步
    act(() => {
      findClickableByText(renderer.root, '全选')!.props.onPress();
    });
    expect(json(renderer)).toContain('全不选');
    expect(json(renderer)).toContain('已选 3 项');
    expect(json(renderer)).toContain('添加 (3)');

    // 全不选：清空，确认按钮禁用
    act(() => {
      findClickableByText(renderer.root, '全不选')!.props.onPress();
    });
    expect(json(renderer)).toContain('已选 0 项');
    const confirmBtn = findButtonByText(renderer.root, '添加');
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn!.props.disabled).toBe(true);

    // 过滤到 gpt 后再全选：只勾中过滤命中的 1 行
    typeQuery(renderer.root, 'gpt');
    act(() => {
      findClickableByText(renderer.root, '全选')!.props.onPress();
    });
    expect(json(renderer)).toContain('已选 1 项');
    expect(json(renderer)).toContain('添加 (1)');
    expect(json(renderer)).not.toContain('添加 (3)');
  });

  it('T-FM5b: 全选为重置语义——被过滤隐藏的旧勾选会被清掉（对齐 desktop T-FM11）', async () => {
    const {renderer} = await renderSheet();
    // 先勾选 claude 行
    act(() => {
      findClickableByText(renderer.root, 'Claude 3 Sonnet')!.props.onPress();
    });
    expect(json(renderer)).toContain('已选 1 项');
    // 过滤 gpt（claude 被隐藏）后全选：重置为 gpt 行全选，claude 旧勾选被清
    typeQuery(renderer.root, 'gpt');
    act(() => {
      findClickableByText(renderer.root, '全选')!.props.onPress();
    });
    expect(json(renderer)).toContain('已选 1 项');
    expect(json(renderer)).toContain('添加 (1)');
    // 清空过滤确认：只剩 gpt 勾选，claude 未勾
    typeQuery(renderer.root, '');
    expect(json(renderer)).toContain('已选 1 项');
  });

  it('T-FM5c: 过滤后无可选行时计数条仍显示（隐藏勾选可见可清，对齐 desktop）', async () => {
    const {renderer} = await renderSheet();
    act(() => {
      findClickableByText(renderer.root, '全选')!.props.onPress();
    });
    expect(json(renderer)).toContain('已选 3 项');
    // 过滤词命中 0 行可选（无匹配）：全量计数基准下计数条仍在，勾选数可见
    typeQuery(renderer.root, 'zzz-no-hit');
    expect(json(renderer)).toContain('已选 3 项');
    expect(json(renderer)).toContain('添加 (3)');
    // 全选按钮隐藏（无可选行），但计数保留
    expect(json(renderer)).not.toContain("全选'");
  });

  it('T-FM6: 批量添加逐个保存，成功后清空勾选并标「已添加」', async () => {
    const {renderer, onSaved} = await renderSheet();
    act(() => {
      findClickableByText(renderer.root, '全选')!.props.onPress();
    });
    await act(async () => {
      findButtonByText(renderer.root, '添加 (3)')!.props.onPress();
    });
    expect(mockProviderModels.save).toHaveBeenCalledTimes(3);
    expect(mockProviderModels.save).toHaveBeenNthCalledWith(
      1,
      'p1',
      'gpt-4o',
      'GPT-4o 对话',
    );
    expect(mockProviderModels.save).toHaveBeenNthCalledWith(
      2,
      'p1',
      'claude-3-sonnet',
      'Claude 3 Sonnet',
    );
    expect(mockProviderModels.save).toHaveBeenNthCalledWith(
      3,
      'p1',
      'ernie-speed',
      undefined,
    );
    expect(onSaved).toHaveBeenCalledTimes(1);

    // 全部已添加、勾选清空（无可选行时计数条隐藏），确认按钮回到禁用态
    expect((json(renderer).match(/已添加/g) ?? []).length).toBe(3);
    expect(json(renderer)).not.toContain('已选');
    const confirmBtn = findButtonByText(renderer.root, '添加');
    expect(confirmBtn!.props.disabled).toBe(true);
  });

  it('T-FM7: 保存中途失败即停止并报错，已成功行标「已添加」、失败行保留勾选', async () => {
    mockProviderModels.save
      .mockImplementationOnce(() => Promise.resolve(undefined))
      .mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const {renderer, onSaved} = await renderSheet();
    act(() => {
      findClickableByText(renderer.root, '全选')!.props.onPress();
    });
    await act(async () => {
      findButtonByText(renderer.root, '添加 (3)')!.props.onPress();
    });

    // 第二次失败即停：ernie-speed 未被保存
    expect(mockProviderModels.save).toHaveBeenCalledTimes(2);
    expect(json(renderer)).toContain('boom');
    expect((json(renderer).match(/已添加/g) ?? []).length).toBe(1);
    // 失败两行保留勾选，方便重试
    expect(json(renderer)).toContain('已选 2 项');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
