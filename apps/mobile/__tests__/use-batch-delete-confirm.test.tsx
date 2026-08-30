/**
 * useBatchDeleteConfirm 三分支单测（screens/C-1 验收）：
 * 确认（逐条删除 + onDone）/ 取消（不动）/ 中途失败（中断 + toast，不回调 onDone）。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Alert} from 'react-native';
import {useBatchDeleteConfirm} from '@/hooks/useBatchDeleteConfirm';

const mockShowToast = jest.fn();

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('@/errors/toast-message', () => ({
  toastMessage: (title: string, _err: unknown) => title,
}));

jest.mock('react-native', () => ({
  Alert: {alert: jest.fn()},
}));

type AlertButton = {text: string; style?: string; onPress?: () => void};

const deleteOne = jest.fn<(id: string) => Promise<void>>();
const onDone = jest.fn(() => Promise.resolve());

function mountConfirm(): (items: readonly string[]) => void {
  let confirm: ((items: readonly string[]) => void) | undefined;
  function TestHost() {
    confirm = useBatchDeleteConfirm<string>({
      title: '删除规则',
      message: items => `确定删除选中的 ${items.length} 条规则？`,
      deleteOne: id => deleteOne(id),
      onDone: () => onDone(),
    });
    return null;
  }
  TestRenderer.act(() => {
    TestRenderer.create(<TestHost />);
  });
  return (items: readonly string[]) => confirm!(items);
}

function alertButtons(): AlertButton[] {
  const calls = (Alert.alert as unknown as jest.Mock).mock.calls;
  return calls[calls.length - 1]![2] as AlertButton[];
}

async function pressConfirm(): Promise<void> {
  await act(async () => {
    alertButtons()
      .find(b => b.text === '删除')
      ?.onPress?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  deleteOne.mockReset();
  onDone.mockReset();
});

describe('useBatchDeleteConfirm', () => {
  it('确认：Alert 文案带条目数，逐条删除后回调 onDone，不弹 toast', async () => {
    deleteOne.mockResolvedValue(undefined);
    const confirm = mountConfirm();

    confirm(['a', 'b']);

    expect(Alert.alert).toHaveBeenCalledWith(
      '删除规则',
      '确定删除选中的 2 条规则？',
      expect.any(Array),
    );
    expect(deleteOne).not.toHaveBeenCalled();

    await pressConfirm();

    expect(deleteOne).toHaveBeenCalledTimes(2);
    expect(deleteOne).toHaveBeenNthCalledWith(1, 'a');
    expect(deleteOne).toHaveBeenNthCalledWith(2, 'b');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('取消：点取消按钮（或不确认）不触发删除与 onDone', async () => {
    deleteOne.mockResolvedValue(undefined);
    const confirm = mountConfirm();

    confirm(['a']);

    const cancel = alertButtons().find(b => b.text === '取消')!;
    expect(cancel.style).toBe('cancel');
    await act(async () => {
      cancel.onPress?.();
      await Promise.resolve();
    });

    expect(deleteOne).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('中途失败：顺序删除到失败项即中断，toast 删除失败，不回调 onDone', async () => {
    deleteOne.mockResolvedValueOnce(undefined);
    deleteOne.mockRejectedValueOnce(new Error('boom'));
    const confirm = mountConfirm();

    confirm(['a', 'b', 'c']);

    await pressConfirm();

    // 已删的 a 保留（部分成功语义），b 失败后不再碰 c
    expect(deleteOne).toHaveBeenCalledTimes(2);
    expect(deleteOne).not.toHaveBeenCalledWith('c');
    expect(onDone).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('删除失败');
  });

  it('空集不弹确认框', () => {
    const confirm = mountConfirm();

    confirm([]);

    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
