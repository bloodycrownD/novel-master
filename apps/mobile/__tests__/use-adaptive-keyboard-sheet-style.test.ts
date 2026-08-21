/**
 * useAdaptiveKeyboardSheetStyle 测试：键盘高度 → maxHeight 收缩数学。
 *
 * mock 体系：jest.config 把 react-native-keyboard-controller / react-native-reanimated
 * 映射到 test-utils mock——useAnimatedStyle 会直接执行 factory（样式即普通对象，
 * 可直接断言），键盘高度经 __setKeyboardHeightForTests 注入（负值 = 弹起，
 * 与真实 hook 语义一致）。屏高不 mock：preset 默认 dimensions 会随升级变，
 * 这里用「ratio=1 + 键盘 0 时 maxHeight = 屏高」在运行时反推。
 */
import React from 'react';
import * as RN from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {__setKeyboardHeightForTests} from '../test-utils/react-native-keyboard-controller-mock';
import {useAdaptiveKeyboardSheetStyle} from '../src/hooks/useAdaptiveKeyboardSheetStyle';

type Style = ReturnType<typeof useAdaptiveKeyboardSheetStyle>;

/** 挂载 Harness 取 hook 返回样式；rerender 用新元素避免 React 同引用 bail out。 */
function mountStyle(
  ratio: number,
  opts?: Parameters<typeof useAdaptiveKeyboardSheetStyle>[1],
): {
  read: () => Style;
  rerender: () => void;
  unmount: () => void;
} {
  const holder: {style?: Style} = {};
  function Harness() {
    holder.style = useAdaptiveKeyboardSheetStyle(ratio, opts);
    return null;
  }
  let root!: TestRenderer.ReactTestRenderer;
  act(() => {
    root = TestRenderer.create(React.createElement(Harness));
  });
  return {
    read: () => holder.style as Style,
    rerender: () => {
      act(() => {
        root.update(React.createElement(Harness));
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

beforeEach(() => {
  __setKeyboardHeightForTests(0);
});

afterEach(() => {
  __setKeyboardHeightForTests(0);
  // Platform.OS 在 Android 用例里被改写，恢复默认 ios
  (RN.Platform as {OS: string}).OS = 'ios';
});

describe('useAdaptiveKeyboardSheetStyle', () => {
  const screenH = (() => {
    const {read, unmount} = mountStyle(1);
    const h = (read() as {maxHeight: number}).maxHeight;
    unmount();
    return h;
  })();

  it('键盘 0：maxHeight 取比例上限，iOS 不带 translateY', () => {
    const {read, unmount} = mountStyle(0.75);
    const style = read() as {maxHeight: number; transform?: unknown};
    expect(style.maxHeight).toBe(screenH * 0.75);
    expect(style.transform).toBeUndefined();
    unmount();
  });

  it('键盘弹起：maxHeight = 屏高 - 键盘（topMargin 默认 0，面板贴屏顶）', () => {
    const harness = mountStyle(0.75);
    // 键盘 500 要大于屏高的 (1-0.75) 剩余份额，收缩才会压过比例上限
    __setKeyboardHeightForTests(-500);
    harness.rerender();
    const style = harness.read() as {maxHeight: number};
    // 屏高 - 500，小于比例上限 0.75*屏高，收缩生效
    expect(style.maxHeight).toBe(screenH - 500);
    harness.unmount();
  });

  it('收缩下限 160：键盘几乎占满屏时 maxHeight 不再往下压', () => {
    const harness = mountStyle(0.85);
    __setKeyboardHeightForTests(-(screenH - 20));
    harness.rerender();
    const style = harness.read() as {maxHeight: number};
    expect(style.maxHeight).toBe(160);
    harness.unmount();
  });

  it('topMargin 自定义：maxHeight = 屏高 - 键盘 - topMargin', () => {
    const harness = mountStyle(0.85, {topMargin: 24});
    __setKeyboardHeightForTests(-300);
    harness.rerender();
    const style = harness.read() as {maxHeight: number};
    // 屏高 - 300 - 24，小于比例上限 0.85*屏高
    expect(style.maxHeight).toBe(screenH - 300 - 24);
    harness.unmount();
  });

  it('Android：样式带 translateY = 键盘高度（负值上移）', () => {
    (RN.Platform as {OS: string}).OS = 'android';
    const harness = mountStyle(0.75);
    __setKeyboardHeightForTests(-500);
    harness.rerender();
    const style = harness.read() as {
      maxHeight: number;
      transform: {translateY: number}[];
    };
    expect(style.transform).toEqual([{translateY: -500}]);
    expect(style.maxHeight).toBe(screenH - 500);
    harness.unmount();
  });

  it('iosTranslateY 默认 false：iOS 键盘弹起仅 maxHeight 收缩，无 translateY', () => {
    // Platform.OS 默认 ios（afterEach 也会恢复或默认），不传选项即默认 false
    const harness = mountStyle(0.75);
    __setKeyboardHeightForTests(-500);
    harness.rerender();
    const style = harness.read() as {maxHeight: number; transform?: unknown};
    expect(style.transform).toBeUndefined();
    expect(style.maxHeight).toBe(screenH - 500);
    harness.unmount();
  });

  it('iosTranslateY: true：iOS 也输出 translateY = 键盘高度（同 Android 公式）', () => {
    const harness = mountStyle(0.75, {iosTranslateY: true});
    __setKeyboardHeightForTests(-500);
    harness.rerender();
    const style = harness.read() as {
      maxHeight: number;
      transform: {translateY: number}[];
    };
    expect(style.transform).toEqual([{translateY: -500}]);
    expect(style.maxHeight).toBe(screenH - 500);
    harness.unmount();
  });

  it('Android 两态都含 translateY：iosTranslateY 显式 false 也不丢', () => {
    (RN.Platform as {OS: string}).OS = 'android';
    for (const iosTranslateY of [false, true]) {
      const harness = mountStyle(0.75, {iosTranslateY});
      __setKeyboardHeightForTests(-300);
      harness.rerender();
      const style = harness.read() as {transform: {translateY: number}[]};
      expect(style.transform).toEqual([{translateY: -300}]);
      harness.unmount();
    }
  });
});
