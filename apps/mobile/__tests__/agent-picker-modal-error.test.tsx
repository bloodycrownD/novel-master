/**
 * AgentPickerModal 错误处理（cr-fix-spec b2/B-1、b2/B-2）：
 * - B-1：加载失败渲染错误文案 + 重试，不再吞错伪装成空态；重试成功恢复列表
 * - B-2：选中写入失败 toast「设置失败」且不回调不关弹窗；成功才 onSelected + onClose
 *
 * 照 fetch-models-sheet.test.tsx 的 TestRenderer 直测风格。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#f8f8f8',
      text: '#111',
      textSecondary: '#666',
      border: '#ccc',
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

const EMPTY_MESSAGE = '暂无可用智能体，请先在智能体配置中添加。';

jest.mock('@/services/agent-picker', () => ({
  AGENT_PICKER_EMPTY_MESSAGE: EMPTY_MESSAGE,
  isAgentPickerRowSelected: (
    agentId: string,
    _index: number,
    currentId?: string,
  ) => agentId === currentId,
  loadAgentPickerRows: jest.fn(),
  loadSessionAgentPickerRows: jest.fn(),
  selectWorkspaceAgent: jest.fn(),
  selectSessionAgent: jest.fn(),
}));

const mockShowToast = jest.fn();

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

const mockRuntime = {state: {}};

jest.mock('@/hooks/useRuntime', () => ({
  // 返回固定引用，避免 reload 的 useCallback 重建导致 effect 无限重跑。
  useRuntime: () => mockRuntime,
}));

import {AgentPickerModal} from '@/components/agent/AgentPickerModal';
import {
  loadAgentPickerRows,
  selectWorkspaceAgent,
} from '@/services/agent-picker';

const mockLoad = loadAgentPickerRows as jest.Mock;
const mockSelect = selectWorkspaceAgent as jest.Mock;

/** 递归收集渲染树里全部展示文本（避开 toJSON 的循环引用）。 */
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

/** 收集节点子树里自有（非可点击后代）文案，避开 backdrop 这类包裹全部内容的节点。 */
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

function json(renderer: TestRenderer.ReactTestRenderer) {
  return treeText(renderer.root);
}

/** 找子树自有文案包含 text 的可点击节点。 */
function findClickableByText(
  root: TestRenderer.ReactTestInstance,
  text: string,
): TestRenderer.ReactTestInstance | undefined {
  return root
    .findAll(n => n.props && typeof n.props.onPress === 'function')
    .find(node => collectText(node).includes(text));
}

/** 找按钮文案精确等于 text 的可点击节点。 */
function findButtonByText(
  root: TestRenderer.ReactTestInstance,
  text: string,
): TestRenderer.ReactTestInstance | undefined {
  return root
    .findAll(n => n.props && typeof n.props.onPress === 'function')
    .find(node => collectText(node).trim() === text);
}

async function renderPicker(
  props: Partial<React.ComponentProps<typeof AgentPickerModal>> = {},
) {
  const onClose = jest.fn();
  const onSelected = jest.fn();
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <AgentPickerModal
        visible
        onClose={onClose}
        onSelected={onSelected}
        {...props}
      />,
    );
  });
  return {renderer: renderer!, onClose, onSelected};
}

describe('AgentPickerModal 错误处理', () => {
  beforeEach(() => {
    mockLoad.mockReset().mockResolvedValue({currentId: undefined, rows: []});
    mockSelect.mockReset().mockResolvedValue(undefined);
    mockShowToast.mockReset();
  });

  it('B-1: 加载失败渲染错误文案与重试，空态文案不出现', async () => {
    mockLoad.mockRejectedValueOnce(new Error('读档失败'));
    const {renderer} = await renderPicker();
    const text = json(renderer);
    expect(text).toContain('读档失败');
    expect(text).toContain('重试');
    expect(text).not.toContain(EMPTY_MESSAGE);
  });

  it('B-1: 点重试成功后恢复列表', async () => {
    mockLoad
      .mockRejectedValueOnce(new Error('读档失败'))
      .mockResolvedValueOnce({
        currentId: 'a1',
        rows: [{agentId: 'a1', label: 'Writer'}],
      });
    const {renderer} = await renderPicker();
    expect(json(renderer)).toContain('读档失败');

    await act(async () => {
      findButtonByText(renderer.root, '重试')!.props.onPress();
    });
    expect(json(renderer)).toContain('Writer');
    expect(json(renderer)).not.toContain('读档失败');
  });

  it('B-2: 选中写入失败 toast「设置失败」且不回调不关闭', async () => {
    mockLoad.mockResolvedValue({
      currentId: 'a1',
      rows: [{agentId: 'a1', label: 'Writer'}],
    });
    mockSelect.mockRejectedValueOnce(new Error('写入炸了'));
    const {renderer, onClose, onSelected} = await renderPicker();

    await act(async () => {
      findClickableByText(renderer.root, 'Writer')!.props.onPress();
    });

    expect(mockShowToast).toHaveBeenCalledWith('设置失败：写入炸了');
    expect(onSelected).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('B-2: 写入成功才 onSelected + onClose', async () => {
    mockLoad.mockResolvedValue({
      currentId: 'a1',
      rows: [{agentId: 'a1', label: 'Writer'}],
    });
    const {renderer, onClose, onSelected} = await renderPicker();

    await act(async () => {
      findClickableByText(renderer.root, 'Writer')!.props.onPress();
    });

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(onSelected).toHaveBeenCalledWith('a1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
