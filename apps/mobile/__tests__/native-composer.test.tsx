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
  remapTokenRanges,
  scanTokensToRanges,
  synthesizeTokenMarkdown,
  synthesizeTokenMarkdownFromRanges,
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
        // 2026-10-07 真机轮 4→8（圆角不明显，半高强圆角药丸观感）
        expect(capsule.borderRadius).toBe(8);
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

  describe('胶囊确认制（tokenRanges prop · 2026-10-07 真机轮拍板）', () => {
    it('手输 $xxx 不成胶囊：打字只重映射既有确认区间、不登记新区间', () => {
      const { input } = renderComposer({ value: '', tokenRanges: [] });
      act(() => {
        input().props.onChangeText('$手动输入的技能');
      });
      // 确认区间为空 → 无论打什么字都不新增胶囊（旧行为会正则全扫出区间）
      expect(lastRanges()).toEqual([]);
    });

    it('胶囊边缘不空格继续打字：贴边插入不并入胶囊', () => {
      const { input } = renderComposer({
        value: '$时序图大纲',
        tokenRanges: [{ start: 0, end: 6 }],
      });
      act(() => {
        input().props.onChangeText('$时序图大纲后续字符');
      });
      // 插入点 == 区间 end（贴右边界）：区间原位保留、插入字符落在区间外
      expect(lastRanges()).toEqual([{ start: 0, end: 6 }]);
    });

    it('粘贴贴边落文：多字符一次性粘贴不并入胶囊（T-CA5 粘贴变体）', () => {
      const { input } = renderComposer({
        value: '$技能',
        tokenRanges: [{ start: 0, end: 3 }],
      });
      act(() => {
        // 模拟剪贴板粘贴：单次 change 事件一次性携带多字符（区别于逐字打字）
        input().props.onChangeText('$技能粘贴内容');
      });
      // 粘贴点 == 区间 end（贴右边界）：区间原位保留，粘贴文本全部落在胶囊外
      expect(lastRanges()).toEqual([{ start: 0, end: 3 }]);
    });

    it('胶囊中段被改动：区间摘除（不再视为那条引用）', () => {
      const { input } = renderComposer({
        value: '$时序图大纲',
        tokenRanges: [{ start: 0, end: 6 }],
      });
      act(() => {
        input().props.onChangeText('$时序x图大纲');
      });
      expect(lastRanges()).toEqual([]);
    });

    it('胶囊前插入：区间右移保留；胶囊整体删除：区间摘除', () => {
      const { input } = renderComposer({
        value: '$时序图大纲 sss',
        tokenRanges: [
          { start: 0, end: 6 },
          { start: 7, end: 10 },
        ],
      });
      act(() => {
        input().props.onChangeText('x$时序图大纲 sss');
      });
      expect(lastRanges()).toEqual([
        { start: 1, end: 7 },
        { start: 8, end: 11 },
      ]);
      act(() => {
        input().props.onChangeText('x sss');
      });
      expect(lastRanges()).toEqual([{ start: 2, end: 5 }]);
    });

    it('M7 外部写入：合成 markdown 只包确认区间（手输 token 不合成链接）', () => {
      const ref = React.createRef<NativeChatComposerInstance>();
      const { input } = renderComposer({
        ref,
        value: '$时序图大纲',
        tokenRanges: [{ start: 0, end: 6 }],
      });
      expect(input).toBeTruthy();
      act(() => {
        ref.current?.setText('$时序图大纲 手输$不成胶囊', 0);
      });
      expect(mockCalls.setValue).toEqual([
        '[$时序图大纲](nmskill://时序图大纲) 手输$不成胶囊',
      ]);
    });

    it('prop 收敛内容相等短路：同内容新数组身份不再二次下发（CR-fix-06）', () => {
      const onChange = jest.fn();
      const { tree } = renderComposer({
        value: '$时序图大纲',
        tokenRanges: [{ start: 0, end: 6 }],
        onComposerChangeText: onChange,
      });
      // 挂载兜底下发 1 次（首帧 ranges）
      expect(mockCalls.setTokenRanges).toHaveLength(1);

      // controller 每键都产出新数组身份（差分重映射产物）：内容逐项相同即
      // 视为已收敛——只更新 ref 不 dispatch。否则这里会形成第二次
      // removeType+addRange+applyFormatting（span 全删重加），打字这一最热
      // 路径上白付一次全量重格式化。
      act(() => {
        tree.update(
          makeElement(onChange, {
            value: '$时序图大纲',
            tokenRanges: [{ start: 0, end: 6 }],
          }),
        );
      });
      expect(mockCalls.setTokenRanges).toHaveLength(1);

      // 内容真变（登记了新胶囊）必须照常下发——注意只动 tokenRanges，
      // value 保持同值：同时改 value 会触发 value 兜底 effect 的
      // commitExternalText（另一条合法下发路径），把 dispatch 次数搅浑。
      act(() => {
        tree.update(
          makeElement(onChange, {
            value: '$时序图大纲',
            tokenRanges: [
              { start: 0, end: 6 },
              { start: 7, end: 9 },
            ],
          }),
        );
      });
      expect(mockCalls.setTokenRanges).toHaveLength(2);
      expect(lastRanges()).toEqual([
        { start: 0, end: 6 },
        { start: 7, end: 9 },
      ]);
    });
  });

  describe('D4 水化三跳（T-CA6）', () => {
    it('首帧 defaultValue 按持久化 ranges 合成（尾追内容不并入胶囊）', () => {
      const { input } = renderComposer({
        value: '$技能尾追',
        tokenRanges: [{ start: 0, end: 3 }],
      });

      // 链接只包 [0,3) 的 `$技能`；水化不再正则全扫（旧行为会包整串）。
      expect(input().props.defaultValue).toBe(
        '[$技能](nmskill://技能)尾追',
      );
    });

    it('运行期水化 setText 三参：跳 remap 直写传入 ranges（基线区间不同也不影响）', () => {
      const ref = React.createRef<NativeChatComposerInstance>();
      renderComposer({
        ref,
        value: 'aaaaaaaaaa',
        tokenRanges: [{ start: 0, end: 10 }],
      });

      // 先种一个与传入 ranges 不同的基线：走 remap 的话，'aaaaaaaaaa' 与
      // '$技能尾追' 的整串差异会与 [0,10) 相交 → 区间摘除 → 合成纯明文。
      act(() => {
        ref.current?.setText('$技能尾追', undefined, [{ start: 0, end: 3 }]);
      });

      expect(
        mockCalls.setValue[mockCalls.setValue.length - 1],
      ).toBe('[$技能](nmskill://技能)尾追');
      expect(lastRanges()).toEqual([{ start: 0, end: 3 }]);
    });

    it('幂等：同内容 ranges 经 prop 收敛不二次下发（mock view 层计数）', () => {
      const onChange = jest.fn();
      const ref = React.createRef<NativeChatComposerInstance>();
      const { tree } = renderComposer({
        ref,
        value: 'aaaaaaaaaa',
        tokenRanges: [{ start: 0, end: 10 }],
        onComposerChangeText: onChange,
      });
      // 挂载兜底下发 1 次（首帧 ranges）
      expect(mockCalls.setTokenRanges).toHaveLength(1);

      act(() => {
        ref.current?.setText('$技能尾追', undefined, [{ start: 0, end: 3 }]);
      });
      // 命令式写入带 ranges 下发 1 次
      expect(mockCalls.setTokenRanges).toHaveLength(2);

      // controller 的反向收敛：同内容新数组身份 → 逐项相等短路，不再下发。
      act(() => {
        tree.update(
          makeElement(onChange, {
            ref,
            value: '$技能尾追',
            tokenRanges: [{ start: 0, end: 3 }],
          }),
        );
      });
      expect(mockCalls.setTokenRanges).toHaveLength(2);
    });
  });

  describe('D11 删除锚接线（T-CA11）', () => {
    it('T-CA11 打字路径：编辑前 selection 下沉——相邻胶囊删左颗，幸存区间保留', () => {
      const { input } = renderComposer({
        value: '$A$B',
        tokenRanges: [
          { start: 0, end: 2 },
          { start: 2, end: 4 },
        ],
      });
      // 原生事件序：选区回调（删前的原子区间右缘）先于文本变更被记录
      act(() => {
        input().props.onChangeSelection({ start: 2, end: 2 });
      });
      act(() => {
        input().props.onChangeText('$B');
      });
      expect(lastRanges()).toEqual([{ start: 0, end: 2 }]);
      // 打字路径依然不回写 setValue（M6 不被接线破坏）
      expect(mockCalls.setValue).toHaveLength(0);
    });

    it('T-CA11 打字路径：未收到选区事件 → 回退现状保守口径（不凭空锚定）', () => {
      const { input } = renderComposer({
        value: '$A$B',
        tokenRanges: [
          { start: 0, end: 2 },
          { start: 2, end: 4 },
        ],
      });
      act(() => {
        input().props.onChangeText('$B');
      });
      expect(lastRanges()).toEqual([]);
    });

    it('T-CA11 ref.setText 光标透传：纯插入锚定结果进入 setTokenRanges（防透传回退）', () => {
      const ref = React.createRef<NativeChatComposerInstance>();
      renderComposer({
        ref,
        value: '$A',
        tokenRanges: [{ start: 0, end: 2 }],
      });

      // 头部插入 `$B`、编辑后光标 2：光标若被丢弃，对齐插入点 1 落在旧区间
      // [0,2) 内部 → 旧胶囊摘除；透传后反推插入点 0 → 旧区间右移 [2,4)。
      act(() => {
        ref.current?.setText('$B$A', 2);
      });

      expect(mockCalls.setValue[mockCalls.setValue.length - 1]).toBe(
        '$B[$A](nmskill://A)',
      );
      expect(lastRanges()).toEqual([{ start: 2, end: 4 }]);
    });
  });

  describe('remapTokenRanges 纯函数（编辑侧语义单测）', () => {
    it('同文本返回拷贝', () => {
      expect(remapTokenRanges('abc', 'abc', [{ start: 0, end: 1 }])).toEqual([
        { start: 0, end: 1 },
      ]);
    });

    it('token 中段删一字 → 该区间摘除、右侧区间平移', () => {
      expect(
        remapTokenRanges('$aa $bb', '$a $bb', [
          { start: 0, end: 3 },
          { start: 4, end: 7 },
        ]),
      ).toEqual([{ start: 3, end: 6 }]);
    });

    it('头部插入 → 区间整体右移', () => {
      expect(
        remapTokenRanges('$a x', 'w$a x', [
          { start: 0, end: 2 },
          { start: 3, end: 4 },
        ]),
      ).toEqual([
        { start: 1, end: 3 },
        { start: 4, end: 5 },
      ]);
    });

    it('多处差异折叠为单编辑区：跨编辑区的区间保守摘除', () => {
      expect(
        remapTokenRanges('x$a y$b z', 'w$a y$b!', [
          { start: 1, end: 3 },
          { start: 5, end: 7 },
        ]),
      ).toEqual([]);
    });

    it('纯插入光标锚（2026-10-20 真机轮）：同 `$` 头新胶囊插在旧胶囊头部——对齐点漂移进旧区间，无光标维持保守摘除', () => {
      // prev=`$agent-config `（旧胶囊 [0,13)），头部插入 `$节拍成章 `：
      // 公共前缀咬住 `$`，对齐插入点=1（旧区间内部）→ 误摘（真机「连插
      // 两颗只剩一颗」缺陷的根因面）。
      expect(
        remapTokenRanges('$agent-config ', '$节拍成章 $agent-config ', [
          { start: 0, end: 13 },
        ]),
      ).toEqual([]);
    });

    it('纯插入光标锚：给编辑后光标（插入段末尾）→ 反推真实插入点 0，旧区间右移保真', () => {
      expect(
        remapTokenRanges(
          '$agent-config ',
          '$节拍成章 $agent-config ',
          [{ start: 0, end: 13 }],
          6, // 光标落在插入段 `$节拍成章 ` 末尾
        ),
      ).toEqual([{ start: 6, end: 19 }]);
    });

    it('纯插入光标锚：守卫不过（反推点前缀不一致）→ 回退对齐点，摘除语义不变', () => {
      // next=`abXbc` 光标 5 反推 t=3：`abc` 非 next 前缀 → 守卫拒收，
      // 用对齐点 2（区间 {0,3} 内）→ 摘除。
      expect(
        remapTokenRanges('abc', 'abXbc', [{ start: 0, end: 3 }], 5),
      ).toEqual([]);
    });

    it('纯插入光标锚：反推点与对齐点一致 → 与既有头部插入语义等价', () => {
      expect(
        remapTokenRanges('$a x', 'w$a x', [{ start: 0, end: 2 }], 1),
      ).toEqual([{ start: 1, end: 3 }]);
    });

    it('T-CA10 删除锚：相邻胶囊删左颗——删除段 [0,2) 覆盖 A，幸存 B 平移保留', () => {
      // 缺陷原样：'$A$B' 退格原子删 A → '$B'。无光标时公共前缀吃掉 '$'，
      // 对齐编辑区 [1,3) 同时咬住 A 尾与 B 头 → 两颗一并摘除（[]）。
      // 编辑前光标 2（A 右缘）反推删除段 [0,2) → 只摘 A、B 平移至 [0,2)。
      expect(
        remapTokenRanges(
          '$A$B',
          '$B',
          [
            { start: 0, end: 2 },
            { start: 2, end: 4 },
          ],
          undefined,
          2,
        ),
      ).toEqual([{ start: 0, end: 2 }]);
    });

    it('T-CA10 删除锚：显式编辑后光标同样构成删除段（命令通道形态）', () => {
      expect(
        remapTokenRanges(
          '$A$B',
          '$B',
          [
            { start: 0, end: 2 },
            { start: 2, end: 4 },
          ],
          0,
          2,
        ),
      ).toEqual([{ start: 0, end: 2 }]);
    });

    it('T-CA10 删除锚：删普通尾字符不摘相邻胶囊（端点相触不算公共字符）', () => {
      // D=[2,3) 与 A=[0,2) 只在端点 2 相触，无公共字符 → A 幸存。
      expect(
        remapTokenRanges('$Ax', '$A', [{ start: 0, end: 2 }], undefined, 3),
      ).toEqual([{ start: 0, end: 2 }]);
    });

    it('T-CA10 删除锚：删右颗胶囊——幸存 A 原位保留', () => {
      expect(
        remapTokenRanges(
          '$A$B',
          '$A',
          [
            { start: 0, end: 2 },
            { start: 2, end: 4 },
          ],
          undefined,
          4,
        ),
      ).toEqual([{ start: 0, end: 2 }]);
    });

    it('T-CA10 删除锚：文本中段删胶囊——删除段按光标定位，右侧幸存区间平移', () => {
      expect(
        remapTokenRanges(
          'x$A$B',
          'x$B',
          [
            { start: 1, end: 3 },
            { start: 3, end: 5 },
          ],
          undefined,
          3,
        ),
      ).toEqual([{ start: 1, end: 3 }]);
    });

    it('T-CA10 删除锚：前向删除（光标在删除段左侧）同语义——无需方向信号', () => {
      // 光标 0、Delete 向前删掉 A：删除段 [0,2)，与退格路径结果一致。
      expect(
        remapTokenRanges(
          '$A$B',
          '$B',
          [
            { start: 0, end: 2 },
            { start: 2, end: 4 },
          ],
          undefined,
          0,
        ),
      ).toEqual([{ start: 0, end: 2 }]);
    });

    it('T-CA10 无编辑前光标：维持现状保守口径（对齐区咬住两颗 → 一并摘除）', () => {
      expect(
        remapTokenRanges('$A$B', '$B', [
          { start: 0, end: 2 },
          { start: 2, end: 4 },
        ]),
      ).toEqual([]);
      // 删普通尾字符的现状结果本来就是幸存（端点贴边不并入），一并锁住。
      expect(remapTokenRanges('$Ax', '$A', [{ start: 0, end: 2 }])).toEqual([
        { start: 0, end: 2 },
      ]);
    });

    it('T-CA10 删除锚守卫：光标越界 / 非整数 / 非纯删除替换 → 回退现状差分口径', () => {
      // 越界光标不可信 → 对齐编辑区 [1,3) → 两颗摘除（现状）。
      expect(
        remapTokenRanges(
          '$A$B',
          '$B',
          [
            { start: 0, end: 2 },
            { start: 2, end: 4 },
          ],
          undefined,
          99,
        ),
      ).toEqual([]);
      // 净缩短但含替换（ab → c）：删 D 一致性守卫不过 → 对齐编辑区 [0,2) → 摘除。
      expect(
        remapTokenRanges('ab', 'c', [{ start: 0, end: 2 }], undefined, 2),
      ).toEqual([]);
      // 非整数光标 → 同守卫拒收。
      expect(
        remapTokenRanges(
          '$A$B',
          '$B',
          [
            { start: 0, end: 2 },
            { start: 2, end: 4 },
          ],
          undefined,
          1.5,
        ),
      ).toEqual([]);
    });
  });

  describe('synthesizeTokenMarkdownFromRanges 非法区间守卫（CR-fix-11）', () => {
    const text = '正文 @a/b 尾';

    it('负 start 跳过：slice(cursor, -1) 会按 from-end 切出错拼文本', () => {
      expect(
        synthesizeTokenMarkdownFromRanges(text, [{ start: -3, end: 2 }]),
      ).toBe(text);
    });

    it('end < start 的翻转区间跳过', () => {
      expect(
        synthesizeTokenMarkdownFromRanges(text, [{ start: 5, end: 2 }]),
      ).toBe(text);
    });

    it('end 越界（> text.length）跳过', () => {
      expect(
        synthesizeTokenMarkdownFromRanges(text, [{ start: 0, end: 99 }]),
      ).toBe(text);
    });

    it('非法区间与合法区间混排：跳过坏的、照常合成好的', () => {
      expect(
        synthesizeTokenMarkdownFromRanges(text, [
          { start: -3, end: 2 },
          { start: 3, end: 7 },
        ]),
      ).toBe('正文 [@a/b](nmtoken://a/b) 尾');
    });
  });

  describe('封顶滚动切换（D7 · Step 7 真机轮补齐）', () => {
    it('未封顶 scrollEnabled=false；顶到 maxHeight 切 true；回落回 false', () => {
      const { input } = renderComposer();
      expect(input().props.scrollEnabled).toBe(false);
      act(() => {
        input().props.onLayout({ nativeEvent: { layout: { height: 122 } } });
      });
      expect(input().props.scrollEnabled).toBe(true);
      act(() => {
        input().props.onLayout({ nativeEvent: { layout: { height: 100 } } });
      });
      expect(input().props.scrollEnabled).toBe(false);
    });
  });
});
