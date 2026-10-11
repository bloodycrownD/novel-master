/**
 * EnrichedMarkdownTextInput 的 Jest mock。
 *
 * 导出可断言的调用记录，方便测试 wrapper 行为。
 */
import React from 'react';
import { View } from 'react-native';

// 调用记录
export const mockCalls = {
  setTokenRanges: [] as Array<Array<{ start: number; end: number }>>,
  setValue: [] as string[],
  setSelection: [] as Array<{ start: number; end: number }>,
  focus: 0,
  blur: 0,
  insertMention: [] as Array<{ displayText: string; url: string }>,
  insertText: [] as string[],
  insertLink: [] as Array<{ text: string; url: string }>,
  setLink: [] as string[],
  removeLink: 0,
  toggleBold: 0,
  toggleItalic: 0,
  toggleUnderline: 0,
  toggleStrikethrough: 0,
  toggleSpoiler: 0,
  toggleHeading: [] as number[],
  toggleUnorderedList: 0,
  toggleOrderedList: 0,
  indentList: 0,
  outdentList: 0,
  copyToClipboard: 0,
  startMention: [] as string[],
};

// 重置所有调用记录
export function resetMockCalls() {
  mockCalls.setTokenRanges = [];
  mockCalls.setValue = [];
  mockCalls.setSelection = [];
  mockCalls.focus = 0;
  mockCalls.blur = 0;
  mockCalls.insertMention = [];
  mockCalls.insertText = [];
  mockCalls.insertLink = [];
  mockCalls.setLink = [];
  mockCalls.removeLink = 0;
  mockCalls.toggleBold = 0;
  mockCalls.toggleItalic = 0;
  mockCalls.toggleUnderline = 0;
  mockCalls.toggleStrikethrough = 0;
  mockCalls.toggleSpoiler = 0;
  mockCalls.toggleHeading = [];
  mockCalls.toggleUnorderedList = 0;
  mockCalls.toggleOrderedList = 0;
  mockCalls.indentList = 0;
  mockCalls.outdentList = 0;
  mockCalls.copyToClipboard = 0;
  mockCalls.startMention = [];
}

// Mock Instance 类型
export interface MockEnrichedMarkdownTextInputInstance {
  focus: () => void;
  blur: () => void;
  measure: () => void;
  measureInWindow: () => void;
  measureLayout: () => void;
  setValue: (markdown: string) => void;
  setSelection: (start: number, end: number) => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleUnderline: () => void;
  toggleStrikethrough: () => void;
  toggleSpoiler: () => void;
  toggleHeading: (level: number) => void;
  toggleUnorderedList: () => void;
  toggleOrderedList: () => void;
  indentList: () => void;
  outdentList: () => void;
  setLink: (url: string) => void;
  insertLink: (text: string, url: string) => void;
  insertText: (text: string) => void;
  insertMention: (displayText: string, url: string) => void;
  setTokenRanges: (ranges: Array<{ start: number; end: number }>) => void;
  startMention: (indicator: string) => void;
  removeLink: () => void;
  copyToClipboard: () => void;
  getMarkdown: () => Promise<string>;
  getCaretRect: () => Promise<{ x: number; y: number; width: number; height: number }>;
}

// Mock 组件
export const EnrichedMarkdownTextInput = React.forwardRef<
  MockEnrichedMarkdownTextInputInstance,
  Record<string, unknown>
>((props, ref) => {
  React.useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        mockCalls.focus++;
      },
      blur: () => {
        mockCalls.blur++;
      },
      measure: () => {},
      measureInWindow: () => {},
      measureLayout: () => {},
      setValue: (markdown: string) => {
        mockCalls.setValue.push(markdown);
      },
      setSelection: (start: number, end: number) => {
        mockCalls.setSelection.push({ start, end });
      },
      toggleBold: () => {
        mockCalls.toggleBold++;
      },
      toggleItalic: () => {
        mockCalls.toggleItalic++;
      },
      toggleUnderline: () => {
        mockCalls.toggleUnderline++;
      },
      toggleStrikethrough: () => {
        mockCalls.toggleStrikethrough++;
      },
      toggleSpoiler: () => {
        mockCalls.toggleSpoiler++;
      },
      toggleHeading: (level: number) => {
        mockCalls.toggleHeading.push(level);
      },
      toggleUnorderedList: () => {
        mockCalls.toggleUnorderedList++;
      },
      toggleOrderedList: () => {
        mockCalls.toggleOrderedList++;
      },
      indentList: () => {
        mockCalls.indentList++;
      },
      outdentList: () => {
        mockCalls.outdentList++;
      },
      setLink: (url: string) => {
        mockCalls.setLink.push(url);
      },
      insertLink: (text: string, url: string) => {
        mockCalls.insertLink.push({ text, url });
      },
      insertText: (text: string) => {
        mockCalls.insertText.push(text);
      },
      insertMention: (displayText: string, url: string) => {
        mockCalls.insertMention.push({ displayText, url });
      },
      setTokenRanges: (ranges: Array<{ start: number; end: number }>) => {
        mockCalls.setTokenRanges.push(ranges);
      },
      startMention: (indicator: string) => {
        mockCalls.startMention.push(indicator);
      },
      removeLink: () => {
        mockCalls.removeLink++;
      },
      copyToClipboard: () => {
        mockCalls.copyToClipboard++;
      },
      getMarkdown: () => Promise.resolve(''),
      getCaretRect: () => Promise.resolve({ x: 0, y: 0, width: 0, height: 0 }),
    }),
    []
  );

  // 渲染成可序列化的 View 节点（而非 null）：测试里 tree.toJSON() 需要
  // 拿到真实节点断言"组件可渲染"，props 原样透传供 wrapper 测试检查。
  return React.createElement(
    View,
    { testID: 'enriched-markdown-text-input-mock', ...(props as object) },
  );
});

EnrichedMarkdownTextInput.displayName = 'EnrichedMarkdownTextInput';

// 阅读组件占位：真实包主入口为 named export（无 default），业务接线时若
// import 到它也能拿到可渲染的最小 mock，不会 undefined 炸渲染树。
export const EnrichedMarkdownText = (props: Record<string, unknown>) =>
  React.createElement(View, {
    testID: 'enriched-markdown-text-mock',
    ...(props as object),
  });
