/**
 * infra/B-2：ThemeProvider setMode 持久化失败不冒泡。
 * appUi.set reject 时 warn 有日志、无 unhandled rejection、乐观 mode 已切换。
 */
import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {ThemeProvider, useTheme} from '../src/theme/ThemeProvider';

const mockAppUi = {
  get: jest.fn(async () => 'light'),
  set: jest.fn(async () => {
    throw new Error('kv busy');
  }),
};

jest.mock('../src/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({appUi: mockAppUi}),
}));

function mountTheme() {
  let ctx: ReturnType<typeof useTheme> | undefined;
  function Harness() {
    ctx = useTheme();
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
  });
  return {
    ctx: () => ctx!,
    unmount: () => renderer.unmount(),
  };
}

describe('ThemeProvider setMode 持久化失败', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppUi.get.mockImplementation(async () => 'light');
    mockAppUi.set.mockImplementation(async () => {
      throw new Error('kv busy');
    });
  });

  it('appUi.set reject：warn 有日志、无 unhandled rejection、乐观切换生效', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    const mounted = mountTheme();
    try {
      // 先等初始水化（appUi.get）完成，避免乐观切换被 hydrate 回写覆盖。
      await act(async () => {
        await new Promise(resolve => setImmediate(resolve));
      });
      expect(mounted.ctx().loaded).toBe(true);

      await act(async () => {
        await mounted.ctx().setMode('dark');
      });
      // 乐观切换已生效，持久化失败不回滚 UI。
      expect(mounted.ctx().mode).toBe('dark');

      await act(async () => {
        // void toggleMode 场景：不 await，也不应产生 unhandled rejection。
        void mounted.ctx().toggleMode();
        await new Promise(resolve => setImmediate(resolve));
      });

      expect(warnSpy).toHaveBeenCalledWith(
        '[ThemeProvider] persist theme mode failed:',
        expect.objectContaining({message: 'kv busy'}),
      );
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      warnSpy.mockRestore();
      mounted.unmount();
    }
  });
});
