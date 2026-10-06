/**
 * NativeChatComposer 行为测试（composer-native-2026-10 Step 3 · T-NC1~T-NC6）。
 *
 * mock 面：`react-native-enriched-markdown` 经 jest moduleNameMapper 映射到
 * `test-utils/enriched-markdown-mock`（Instance 全命令记录），测试视角是
 * 「断言 wrapper（组件）对 mock 输入组件的驱动行为」——原生侧真实行为
 * （胶囊渲染、IME 组合态、原子删整删）属真机 QA（Step 7），不在本套件内。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import type { ConversationTheme } from '../src/components/chat/ChatConversationBridge';
import {
  NativeChatComposer,
  COMPOSER_HEIGHT_EPSILON,
  COMPOSER_PLACEHOLDER_WITH_MODEL,
  COMPOSER_PLACEHOLDER_WITHOUT_MODEL,
  type NativeChatComposerInstance,
} from '../src/components/chat/NativeChatComposer';
import type { NativeChatComposerProps } from '../src/components/chat/NativeChatComposer';
import { composerTokenRanges } from '../src/components/chat/composer-highlight';
import {
  scanTokensToRanges,
  synthesizeTokenMarkdown,
} from '../src/components/chat/native-composer/token-ranges';
import { composerInputMetrics } from '../src/components/chat/native-composer/dock-style';
import { tryAtomicRangeDelete } from '../src/components/common/atomic-range-delete';
import {
  EnrichedMarkdownTextInput,
  mockCalls,
  resetMockCalls,
} from '../test-utils/enriched-markdown-mock';

// React 19 下 create 的初始渲染走并发调度，不包 act 时 layout effect
//（useImperativeHandle 挂 ref）不保证同步 flush——统一经这里渲染。
const renderWithAct = (ui: React.ReactElement): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(ui);
  });
  return tree;
};

const THEME: ConversationTheme = {
  background: '#000000',
  text: '#ffffff',
  textSecondary: '#999999',
  primary: '#5865f2',
  primaryMuted: '#5865f222',
  selection: '#333333',
  danger: '#ff0000',
  surface: '#111111',
  borderLight: '#222222',
};

type ComposerOverrides = Partial<NativeChatComposerProps>;

const makeElement = (
  onChange: (text: string) => void,
  overrides: ComposerOverrides = {},
) => (
  <NativeChatComposer
    testID="native-composer"
    value=""
    hasModel
    disabled={false}
    theme={THEME}
    onComposerChangeText={onChange}
    onComposerSelectionChange={() => undefined}
    {...overrides}
  />
);

const renderComposer = (overrides: ComposerOverrides = {}) => {
  const onChange = jest.fn();
  const tree = renderWithAct(makeElement(onChange, overrides));
  // findByType 而非 findByProps：findByProps({testID}) 会先命中
  // NativeChatComposer 自身的 fiber（props 里恰好也有 testID），
  // 拿不到传给库组件的透传面；findByType 直接锁 mock 组件元素，
  // 其 props 即组件 → 库的全部透传 props（onChangeText/style/...）。
  const input = () => tree.root.findByType(EnrichedMarkdownTextInput);
  return { tree, onChange, input };
};

/** mock 记录里的 ranges → 与纯函数输出同形态比对（消掉类型面差异）。 */
const lastRanges = () => mockCalls.setTokenRanges[mockCalls.setTokenRanges.length - 1];

const toRangeShapes = (plain: string) =>
  composerTokenRanges(plain).map(r => ({ start: r.start, end: r.end }));

describe('NativeChatComposer（T-NC1~T-NC6）', () => {
  beforeEach(() => {
    resetMockCalls();
  });

  it('T-NC1 明文变化 → setTokenRanges 收到 composerTokenRanges 同款区间', () => {
    const { input } = renderComposer();

    const plain = '看看 @src/a.ts 和 $技能名 好了';
    act(() => {
      input().props.onChangeText(plain);
    });

    // 挂载兜底 1 次（空初值 ranges=[]）+ 本次打字 1 次
    expect(mockCalls.setTokenRanges).toHaveLength(2);
    expect(lastRanges()).toEqual(toRangeShapes(plain));
    // 双 token：区间互不重叠且按出现顺序（正则真源 composer-highlight.ts）
    expect(lastRanges()).toHaveLength(2);
    expect(lastRanges()![0]!.start).toBeLessThan(lastRanges()![0]!.end);
    expect(lastRanges()![1]!.start).toBeGreaterThan(lastRanges()![0]!.end);

    // 无 token 的明文也照常下发（空数组全量清空，库端先清后加幂等）
    act(() => {
      input().props.onChangeText('纯文本没有 token');
    });
    expect(mockCalls.setTokenRanges).toHaveLength(3);
    expect(lastRanges()).toEqual([]);

    // 变异验证（spec T-NC1 口径「删下发必红」）：删掉 NativeChatComposer 的
    // handleChangeText 里 dispatchTokenRanges(plain) 一行后运行本套件，
    // 上面 setTokenRanges 长度断言即红——测试锁的就是这条下发链本身。
  });

  it('T-NC2 ref.setText 推进基线 + 合成 markdown 进 setValue + change 补发', () => {
    const ref = React.createRef<NativeChatComposerInstance>();
    const { tree, onChange, input } = renderComposer({ ref });
    const plain = '@src/a.ts 是重点';

    act(() => {
      ref.current?.setText(plain, 12);
    });

    // 合成 markdown 进 setValue（@ → nmtoken 链接，普通段原样）
    expect(mockCalls.setValue).toEqual([
      '[@src/a.ts](nmtoken://src/a.ts) 是重点',
    ]);
    // token ranges 同步下发（挂载兜底 1 次 + setText 1 次）
    expect(mockCalls.setTokenRanges).toHaveLength(2);
    expect(lastRanges()).toEqual(toRangeShapes(plain));
    // 可选光标落位（M7 通道 cursor 透传）
    expect(mockCalls.setSelection).toEqual([{ start: 12, end: 12 }]);
    // E10/F6 补发语义：setValue 期间库事件被抑制，change 由组件主动补发
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(plain);

    // 基线已推进（M1）：controller 把同一明文回写 value（回声）时，
    // value effect 同值早退——不产生第二次 setValue（M6 不被回声破坏）
    expect(input().props.editable).toBe(true);
    act(() => {
      tree.update(
        makeElement(onChange, { ref, value: plain }),
      );
    });
    expect(mockCalls.setValue).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('T-NC3 打字路径不回写 setValue（M6）', () => {
    const { input } = renderComposer();

    act(() => {
      input().props.onChangeText('第');
    });
    act(() => {
      input().props.onChangeText('第一键');
    });
    act(() => {
      input().props.onChangeText('第一键@src');
    });

    // 逐键 onChange 回调链里 setValue 必须零调用：打字真源在库内部编辑器态
    expect(mockCalls.setValue).toHaveLength(0);
    // ranges 照常逐键下发（挂载兜底 1 次 + 打字 3 次）
    expect(mockCalls.setTokenRanges).toHaveLength(4);
  });

  it('T-NC4 高度钳制：maxHeight=122 单源 + 死区 0.5 + 首帧豁免', () => {
    // 常量口径：dock-style.ts 单源（5 行封顶 = paddingV×2 + lineHeight×5）
    expect(composerInputMetrics.maxHeight).toBe(122);
    expect(COMPOSER_HEIGHT_EPSILON).toBe(0.5);

    const onHeightChange = jest.fn();
    const { input } = renderComposer({ onHeightChange });

    // 样式面：maxHeight/minHeight 等从 dock-style.ts 常量取，不出现第二份数值
    expect(input().props.style.maxHeight).toBe(composerInputMetrics.maxHeight);
    expect(input().props.style.minHeight).toBe(composerInputMetrics.minHeight);
    expect(input().props.style.fontSize).toBe(composerInputMetrics.fontSize);
    expect(input().props.style.lineHeight).toBe(composerInputMetrics.lineHeight);
    // D7：自动长高组合
    expect(input().props.scrollEnabled).toBe(false);

    const layout = (height: number) => {
      act(() => {
        input().props.onLayout({ nativeEvent: { layout: { height } } });
      });
    };

    // 首帧豁免：从未上报过（null）无条件上抛
    layout(56);
    expect(onHeightChange).toHaveBeenCalledTimes(1);
    expect(onHeightChange).toHaveBeenLastCalledWith(56);

    // 死区内（|Δ| ≤ 0.5）不上抛
    layout(56.3);
    expect(onHeightChange).toHaveBeenCalledTimes(1);

    // 超出死区上抛
    layout(78);
    expect(onHeightChange).toHaveBeenCalledTimes(2);
    expect(onHeightChange).toHaveBeenLastCalledWith(78);

    // 恰好等于死区边界（Δ = 0.5 ≤ 0.5）不上抛
    layout(78.5);
    expect(onHeightChange).toHaveBeenCalledTimes(2);

    // 封顶高度上抛（5 行口径）
    layout(122);
    expect(onHeightChange).toHaveBeenCalledTimes(3);
    expect(onHeightChange).toHaveBeenLastCalledWith(122);
  });

  it('T-NC5 草稿水化：明文 → 合成 markdown setValue → ranges（老草稿照常出胶囊）', () => {
    const { tree, onChange } = renderComposer();
    // 空初值（无草稿）不触发任何写入
    expect(mockCalls.setValue).toHaveLength(0);

    // 外部直改 state（水化路径）：value effect 兜底经 M7 通道进框
    const draft = '@src/a.ts $技能';
    act(() => {
      tree.update(makeElement(onChange, { value: draft }));
    });

    // setValue 收到合成 markdown：@ → nmtoken、$ → nmskill（D3 形态）
    expect(mockCalls.setValue).toEqual([
      '[@src/a.ts](nmtoken://src/a.ts) [$技能](nmskill://技能)',
    ]);
    // 区间正确（两个完整 token，含触发符）
    expect(lastRanges()).toEqual(toRangeShapes(draft));
    // 水化同样补发 change（controller 同值去重兜底）
    expect(onChange).toHaveBeenCalledWith(draft);

    // 老草稿明文照常出胶囊：合成链路对存量草稿零迁移——普通路径 + 转义兜底
    expect(synthesizeTokenMarkdown('正文 @a/b 结尾')).toBe(
      '正文 [@a/b](nmtoken://a/b) 结尾',
    );
    // 病态 token（displayText 含 ]）不合成链接、明文原样——胶囊由 TOKEN span 兜底
    act(() => {
      tree.update(makeElement(onChange, { value: '破 @a]b 尾' }));
    });
    expect(mockCalls.setValue).toEqual([
      '[@src/a.ts](nmtoken://src/a.ts) [$技能](nmskill://技能)',
      '破 @a]b 尾',
    ]);
    expect(lastRanges()).toEqual(toRangeShapes('破 @a]b 尾'));
  });

  it('T-NC6 ranges 与 tryAtomicRangeDelete 的区间语义一致性（mock 面）', () => {
    // 本用例锁的是「RN 侧喂给原生的 token 区间」与「RN 侧原子删断言链
    // （tryAtomicRangeDelete）」吃的是同一套区间形状——退格删除窗与区间
    // 相交即整段摘除。原生侧的退格整删接线（Kotlin deleteLinkBeforeCursor
    // 并入 TOKEN）属真机 QA（Step 7），mock 无编辑器文本态，不在此断言。
    const prev = '看看 @src/a.ts 后续';
    const ranges = scanTokensToRanges(prev);
    expect(ranges).toEqual([{ start: 3, end: 12 }]);

    // 场景 A：删除窗落在 token 中段（删一个 token 内字符）→ 整段摘除，
    // 返回串 = prev 去掉整个命中区间（区间形状语义与原生整删一致）
    const delInToken = 8; // '@src/a.ts' 内的 'a'
    const nextA = prev.slice(0, delInToken) + prev.slice(delInToken + 1);
    expect(tryAtomicRangeDelete(prev, nextA, ranges)).toBe(
      prev.slice(0, 3) + prev.slice(12),
    );

    // 场景 B：删除窗在 token 之前（删 token 前的普通字符）→ 不拦截
    const nextB = prev.slice(0, 1) + prev.slice(2);
    expect(tryAtomicRangeDelete(prev, nextB, ranges)).toBeNull();

    // 场景 C：删除窗完整覆盖 token（整体删除）→ 交给默认差分（null）
    const nextC = prev.slice(0, 3) + prev.slice(12);
    expect(tryAtomicRangeDelete(prev, nextC, ranges)).toBeNull();

    // 场景 D：非删除操作（增长）→ 非删除一律不拦截
    expect(tryAtomicRangeDelete(prev, `${prev}!`, ranges)).toBeNull();
  });

  describe('props 语义（对齐 controller 的消费面）', () => {
    it('placeholder 随 hasModel 切换', () => {
      const withModel = renderComposer({ hasModel: true });
      expect(withModel.input().props.placeholder).toBe(
        COMPOSER_PLACEHOLDER_WITH_MODEL,
      );
      const withoutModel = renderComposer({ hasModel: false });
      expect(withoutModel.input().props.placeholder).toBe(
        COMPOSER_PLACEHOLDER_WITHOUT_MODEL,
      );
    });

    it('disabled 走 editable（readOnly）透传且不淡出', () => {
      const enabled = renderComposer({ disabled: false });
      expect(enabled.input().props.editable).toBe(true);
      const disabled = renderComposer({ disabled: true });
      expect(disabled.input().props.editable).toBe(false);
    });

    it('主题 9 键 → markdownStyle：胶囊两变体色值/几何对齐 dock-style 单源', () => {
      const { input } = renderComposer();
      const markdownStyle = input().props.markdownStyle;
      // linkVariants 按 URL 正则挂两变体（nmtoken / nmskill）
      expect(Object.keys(markdownStyle.linkVariants).sort()).toEqual([
        '^nmskill:',
        '^nmtoken:',
      ]);
      for (const capsule of [
        markdownStyle.link,
        markdownStyle.linkVariants['^nmtoken:'],
        markdownStyle.linkVariants['^nmskill:'],
      ]) {
        expect(capsule.color).toBe(THEME.primary);
        expect(capsule.backgroundColor).toBe(THEME.primaryMuted);
        expect(capsule.borderRadius).toBe(4);
        expect(capsule.paddingHorizontal).toBe(4);
        expect(capsule.paddingTop).toBe(1);
        expect(capsule.paddingBottom).toBe(1);
      }
      // 基础文本色
      expect(input().props.style.color).toBe(THEME.text);
    });

    it('选区变化上行透传', () => {
      const onSelection = jest.fn();
      const { input } = renderComposer({ onComposerSelectionChange: onSelection });
      act(() => {
        input().props.onChangeSelection({ start: 4, end: 9 });
      });
      expect(onSelection).toHaveBeenCalledWith({ start: 4, end: 9 });
    });
  });
});
