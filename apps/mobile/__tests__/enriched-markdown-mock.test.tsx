/**
 * EnrichedMarkdownTextInput mock 形态测试。
 *
 * 锁 mock 形态：import 不炸、命令方法可调用可记录。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import {
  EnrichedMarkdownTextInput,
  mockCalls,
  resetMockCalls,
  type MockEnrichedMarkdownTextInputInstance,
} from '../test-utils/enriched-markdown-mock';

// React 19 下 create 的初始渲染走并发调度，不包 act 时 layout effect
// （useImperativeHandle 挂 ref）不保证同步 flush，ref.current 会是空——
// 统一经这里渲染，保证 ref 挂接与可渲染断言同时成立。
const renderWithAct = (ui: React.ReactElement): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(ui);
  });
  return tree;
};

describe('EnrichedMarkdownTextInput mock', () => {
  beforeEach(() => {
    resetMockCalls();
  });

  it('import 不炸，组件可渲染', () => {
    const tree = renderWithAct(<EnrichedMarkdownTextInput />);
    expect(tree.toJSON()).toBeTruthy();
    act(() => {
      tree.unmount();
    });
  });

  it('setTokenRanges 可调用可记录', () => {
    const ref = React.createRef<MockEnrichedMarkdownTextInputInstance>();
    const tree = renderWithAct(<EnrichedMarkdownTextInput ref={ref} />);

    const ranges = [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ];
    ref.current?.setTokenRanges(ranges);

    expect(mockCalls.setTokenRanges).toHaveLength(1);
    expect(mockCalls.setTokenRanges[0]).toEqual(ranges);

    act(() => {
      tree.unmount();
    });
  });

  it('setValue 可调用可记录', () => {
    const ref = React.createRef<MockEnrichedMarkdownTextInputInstance>();
    const tree = renderWithAct(<EnrichedMarkdownTextInput ref={ref} />);

    ref.current?.setValue('# Hello');

    expect(mockCalls.setValue).toEqual(['# Hello']);

    act(() => {
      tree.unmount();
    });
  });

  it('setSelection 可调用可记录', () => {
    const ref = React.createRef<MockEnrichedMarkdownTextInputInstance>();
    const tree = renderWithAct(<EnrichedMarkdownTextInput ref={ref} />);

    ref.current?.setSelection(0, 5);

    expect(mockCalls.setSelection).toEqual([{ start: 0, end: 5 }]);

    act(() => {
      tree.unmount();
    });
  });

  it('focus/blur 可调用可记录', () => {
    const ref = React.createRef<MockEnrichedMarkdownTextInputInstance>();
    const tree = renderWithAct(<EnrichedMarkdownTextInput ref={ref} />);

    ref.current?.focus();
    ref.current?.blur();

    expect(mockCalls.focus).toBe(1);
    expect(mockCalls.blur).toBe(1);

    act(() => {
      tree.unmount();
    });
  });

  it('insertMention 可调用可记录', () => {
    const ref = React.createRef<MockEnrichedMarkdownTextInputInstance>();
    const tree = renderWithAct(<EnrichedMarkdownTextInput ref={ref} />);

    ref.current?.insertMention('user', 'nmtoken://user');

    expect(mockCalls.insertMention).toEqual([
      { displayText: 'user', url: 'nmtoken://user' },
    ]);

    act(() => {
      tree.unmount();
    });
  });

  it('toggleBold 可调用可记录', () => {
    const ref = React.createRef<MockEnrichedMarkdownTextInputInstance>();
    const tree = renderWithAct(<EnrichedMarkdownTextInput ref={ref} />);

    ref.current?.toggleBold();

    expect(mockCalls.toggleBold).toBe(1);

    act(() => {
      tree.unmount();
    });
  });
});
