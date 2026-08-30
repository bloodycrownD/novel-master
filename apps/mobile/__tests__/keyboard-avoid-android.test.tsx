/**
 * Bug6 弹窗类结构断言测试（T-KB2 / T-KB3）。
 *
 * 参照 screen-form-layout.test.tsx T-KB1 的做法：mock Platform.OS='android'，
 * 断言目标弹窗在 Android 分支渲染了 Animated.View 接线（panel 级 translateY），
 * 并且不再走 KeyboardAvoidingView 的 Android 路径（即外层包裹不是 KeyboardAvoidingView）。
 *
 * T-KB4（整页类 SessionDetailScreen / ChatHistorySearchScreen）的断言分别在
 * session-detail-screen.test.tsx 和 chat-history-search-screen.test.tsx 里，
 * 因为那两个测试文件已经 mock 好了各自的重依赖。
 *
 * mock 基建在 jest.config.js 里已就位：
 * - react-native-reanimated → test-utils/react-native-reanimated-mock.tsx
 *   （Animated.View 直接映射为 RN View，useAnimatedStyle 执行 factory 返回对象）
 * - react-native-keyboard-controller → test-utils/react-native-keyboard-controller-mock.tsx
 *   （useReanimatedKeyboardAnimation 返回 {height:{value:0}, progress:{value:0}}）
 */
import React from 'react';
import {Platform} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';

import {TextPromptModal} from '@/components/ui/TextPromptModal';
import {DirectoryRuleSheet} from '@/components/sheet/DirectoryRuleSheet';
import {useAndroidModalKeyboardAvoid} from '@/hooks/useAndroidModalKeyboardAvoid';

// ── 公共 mock：theme / AppModal ────────────────────────────────────────────
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      bgSecondary: '#eee',
      surface: '#f8f8f8',
      surfaceElevated: '#f0f0f0',
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

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

// ── 平台切换工具 ───────────────────────────────────────────────────────────
/** 覆盖 Platform.OS 为指定平台；用 getter 描述符以兼容 RN jest-preset 的 Platform 实现。 */
function setPlatform(os: 'android' | 'ios') {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    get: () => os,
  });
}

/** 在渲染树里查找带 transform 样式的节点（来自 useAnimatedStyle 的产出）。 */
function findNodeWithTransform(
  root: TestRenderer.ReactTestInstance,
): TestRenderer.ReactTestInstance | undefined {
  return root.findAll(node => {
    const style = node.props?.style;
    if (style == null) {
      return false;
    }
    const styles = Array.isArray(style) ? style : [style];
    return styles.some(
      s =>
        s != null &&
        typeof s === 'object' &&
        Array.isArray((s as {transform?: unknown[]}).transform),
    );
  })[0];
}

/** 统计渲染树里 KeyboardAvoidingView 类型节点的数量。 */
function countKeyboardAvoidingView(
  root: TestRenderer.ReactTestInstance,
): number {
  return root.findAllByType(KeyboardAvoidingView as never).length;
}

// ════════════════════════════════════════════════════════════════════════════
// T-KB2：TextPromptModal（居中弹窗，fraction=0.5）
// ════════════════════════════════════════════════════════════════════════════
describe('T-KB2 TextPromptModal Android 键盘避让', () => {
  beforeEach(() => {
    setPlatform('android');
  });
  afterEach(() => {
    setPlatform('ios');
  });

  it('Android 分支：panel 挂 Animated.View 的 translateY 避让，不走 KeyboardAvoidingView', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <TextPromptModal
          visible
          title="新建"
          onClose={jest.fn() as never}
          onConfirm={jest.fn() as never}
        />,
      );
    });

    // panel 级 Animated.View 带 transform（panelAvoidStyle 产出 translateY）
    const nodeWithTransform = findNodeWithTransform(tree.root);
    expect(nodeWithTransform).toBeDefined();

    // Android 分支外层是普通 View，不再有 KeyboardAvoidingView
    expect(countKeyboardAvoidingView(tree.root)).toBe(0);
  });

  it('iOS 分支：仍走 KeyboardAvoidingView（回归保护）', () => {
    setPlatform('ios');
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <TextPromptModal
          visible
          title="新建"
          onClose={jest.fn() as never}
          onConfirm={jest.fn() as never}
        />,
      );
    });
    expect(countKeyboardAvoidingView(tree.root)).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
// T-KB3：底部对齐 sheet（DirectoryRuleSheet + TextPromptModal variant="bottom"，
// 已吸收原 AddModelModal / EditModelNameModal）
// ════════════════════════════════════════════════════════════════════════════
describe('T-KB3 底部对齐 sheet Android 键盘避让', () => {
  beforeEach(() => {
    setPlatform('android');
  });
  afterEach(() => {
    setPlatform('ios');
  });

  it('DirectoryRuleSheet：panel 挂 translateY（fraction=1，整键盘高度），不走 KeyboardAvoidingView', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <DirectoryRuleSheet
          visible
          logicalPath="/p1"
          onClose={jest.fn() as never}
          onSave={jest.fn() as never}
        />,
      );
    });

    expect(findNodeWithTransform(tree.root)).toBeDefined();
    expect(countKeyboardAvoidingView(tree.root)).toBe(0);
  });

  it('TextPromptModal(bottom，双输入)：panel 挂 translateY，不走 KeyboardAvoidingView', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <TextPromptModal
          visible
          variant="bottom"
          title="添加模型"
          fields={[
            {label: '厂商模型 ID', placeholder: '如 gpt-4o'},
            {label: '模型名称（可选）', optional: true},
          ]}
          onClose={jest.fn() as never}
          onConfirm={jest.fn() as never}
        />,
      );
    });

    expect(findNodeWithTransform(tree.root)).toBeDefined();
    expect(countKeyboardAvoidingView(tree.root)).toBe(0);
  });

  it('TextPromptModal(bottom，重命名)：panel 挂 translateY，不走 KeyboardAvoidingView', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <TextPromptModal
          visible
          variant="bottom"
          title="重命名模型"
          label="模型名称"
          initialValue="gpt-4"
          onClose={jest.fn() as never}
          onConfirm={jest.fn() as never}
        />,
      );
    });

    expect(findNodeWithTransform(tree.root)).toBeDefined();
    expect(countKeyboardAvoidingView(tree.root)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// T-KB3 续：VfsFileManager 内联 prompt
// VfsFileManager 依赖较重（vfs/workplace service），prompt 只在 prompt!=null 时渲染。
// 这里验证共用 hook 存在且可调用；VfsFileManager 自身的集成测试由
// vfs-file-manager.session.integration.test.tsx 覆盖，不在此重复。
// ════════════════════════════════════════════════════════════════════════════
describe('T-KB3 VfsFileManager 共用 hook', () => {
  it('useAndroidModalKeyboardAvoid hook 存在且可调用', () => {
    expect(typeof useAndroidModalKeyboardAvoid).toBe('function');
  });
});
