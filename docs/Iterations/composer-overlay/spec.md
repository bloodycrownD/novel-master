---
date: 2026-09-28
---

# 移动端输入框 overlay 高亮重写 技术规格（SPEC）

需求来源：`docs/Iterations/composer-overlay/prd.md`（已确认）。PRD Front Matter `dependency: []`。

## 设计目标

按 PRD 四目标落地：打字零闪烁（模拟器判定）、手输即时高亮（桌面 `AT_TOKEN_RE` 口径）、双端统一真胶囊（Android 圆角不可用降级方角）、摘除 `react-native-controlled-mentions`。行为底线：1.5.9（IME 组合期不丢字）、1.5.10（打字不降级 tag）两案的对外表现不回归；对外契约（value 恒 plain / onChangeText / onSelectionChange / ref / testID / 样式口径）不变。

## 总体方案

**架构**：两组件（chat `ComposerAtPathInput`、宏 `PromptMacroTextInput`）从「TextInput children 内嵌 span」改为桌面同构 overlay——**流内高亮层定尺寸 + 透明文字 TextInput absolute 覆盖**：

```
<View style={{position:'relative', minHeight, maxHeight}}>   // stack 容器
  <ScrollView scrollEnabled={false} ref={hlRef}>              // 高亮层：流内、不可交互、定尺寸
    <Text style={[inputMetrics, {color: tokens.text}]}>
      {segments.map(s => s.kind==='token'
        ? <Text key={i} style={pillStyle(tokens)}>{s.text}</Text>
        : s.text)}
    </Text>
  </ScrollView>
  <TextInput
    style={[inputMetrics, absoluteFill, {color:'transparent'}]}
    value={plain}                    // 受控 plain，无任何变换
    onChangeText={handleChange}      // 原子删 prev/next 比较后透传
    onScroll={syncHighlight}         // contentOffset → hlRef.scrollTo
    selectionColor={tokens.selection} // 光标/选区可见
    ... />
</View>
```

核心变化与消除面：

1. **value 受控 plain、零变换**：打字路径 `onChangeText(原生上报)` 直通父级（仅原子删拦截），不存在 markup↔plain 对账——1.5.9 丢字源（库差分重建）与 1.5.10 降级源（对账失配重建）随架构消失；行为底线由 jest 组合态序列用例守护（见测试策略）。
2. **手输即时高亮**：高亮层无状态，`splitComposerTokenSegments(plain)`（桌面 `AT_TOKEN_RE = /@([^\s@$]+)|\$([^\s$@]+)/g` 口径：`@`/`$` 字符类互斥不互吞、token 前无空白要求、以空白截止）逐帧 useMemo 切分。markup 状态制整体拆除。
3. **水化简化**：外部 `value` 变化即 plain 变化，高亮层自动重切，`promotePlainMentions` 链路删除。
4. **原子删泛化**：宏版 `tryAtomicMacroDelete` 的算法骨架（prefix 对齐 diff + 区间相交 + 整段覆盖判定）泛化为 `tryAtomicRangeDelete(prev, next, ranges)`，chat 传 token 区间、宏传白名单宏区间，单源双用。
5. **滚动同步主线（方案 a，桌面同构）**：TextInput multiline 自身内滚，`onScroll` 将 `contentOffset` 镜像给高亮层 ScrollView（`scrollTo`，iOS 加 `scrollEventThrottle={16}`）。**Step 1 spike 验证**，不通过切备选方案 b（单滚动域：`scrollEnabled={false}` 的 TextInput 与高亮层同置外层 ScrollView，两层高度严格一致）。
6. **胶囊样式档位**（Step 1 spike 拍板，以「换行点与纯文本一致」为准绳）：首选 `paddingHorizontal:3 + 水平负 margin`（桌面手法，RN Text 负 margin 未验证）；不可用则 `paddingHorizontal:0` 保底（背景自然包裹，测量零漂移——历史上 padding 致换行点漂移是 ux-fixes-2026-08 R1 根因，勿重蹈）；中间档 `paddingHorizontal:3` 无负 margin（接受轻微换行差异）仅在前两档都不可行时评估。

## 最终项目结构

```
apps/mobile/src/components/
  common/
    overlay-input.tsx            [新增] OverlayTextInputStack + useOverlayScrollSync + pillTextStyle(tokens)
    atomic-range-delete.ts       [新增] tryAtomicRangeDelete(prev,next,ranges) 泛化原子删
  chat/
    ComposerAtPathInput.tsx      [重写] overlay 化；ref 收敛为 replaceCommittedText
    composer-highlight.ts        [新增] splitComposerTokenSegments + composerTokenRanges
    composer-at-path-mention.ts  [删除] 全部 src 消费方在 ComposerAtPathInput 内（探索实证）
    ChatComposer.tsx             [小改] replaceActiveAt 调用点单路径化
  agent/
    PromptMacroTextInput.tsx     [重写] overlay 化；props 契约不变（无 ref）
    prompt-macro-input.ts        [改造] tryAtomicMacroDelete 改为泛化版薄封装；splitPromptMacroSegments 不动
__tests__/
  composer-at-path.test.tsx      [迁移] 见变更点清单
  chat-composer.integration.test.tsx [迁移] T-CR4①② 重生
  prompt-macro-text-input.test.tsx   [迁移] value+children 互斥守门改 overlay 守门
  overlay-input.test.tsx         [新增]
  composer-highlight.test.ts     [新增]
  atomic-range-delete.test.ts    [新增]
  prompt-macro-input.test.ts     [不动] 13 用例守护泛化原子删等价
```

不动：`FormTextInput.tsx`、`ExpandablePromptInput.tsx`、`DynamicBlocksCard.tsx`、`PromptLayoutSection.tsx`、`prompt-collapse.ts`、`composer-at-path.ts`、`composer-token-insert.ts`、`chat-composer-draft.ts`、`apps/mobile/e2e/`（仅依赖 testID 直通与 getText）、`jest.config.js`（包名前缀 `react-native` 已在 babel transform 白名单，删除依赖无需改配置）。

## 变更点清单

| # | 文件 | 变更 |
|---|---|---|
| 1 | `src/components/common/overlay-input.tsx` | 新增共享 overlay 基础：stack 布局（流内高亮 ScrollView + absoluteFill 透明 TextInput）、`useOverlayScrollSync`（onScroll → 高亮层 scrollTo；spike 拍板方案 a/b 二选一落地）、`pillTextStyle(tokens)`（字色 `tokens.primary` + 底 `${primary}22` + borderRadius 6 + 横向 padding 档位）；兼容 props 传 tokens（宏链）与 useTheme（chat 链）双通道 |
| 2 | `src/components/common/atomic-range-delete.ts` | `tryAtomicRangeDelete(prev, next, ranges)`：从 `prompt-macro-input.ts:111-147` 泛化（非删除 null → prefix 对齐 → 尾段对账 → 区间相交 → 已覆盖整段 null → 整段删返回） |
| 3 | `src/components/chat/composer-highlight.ts` | `composerTokenRanges(plain)`（token 区间版，供原子删）+ `splitComposerTokenSegments(plain)`（供高亮，含 `@a$b` 互斥、孤立 `$` 不成 token、无前置空白要求） |
| 4 | `src/components/chat/ComposerAtPathInput.tsx` | 重写：受控 plain value、零变换 onChangeText（原子删拦截）、高亮层渲染、保留 `pendingSelection` 短暂受控模式与 `applyPendingSelection`、`cursor` prop 保留（外部受控光标驱动 typeahead）、`onSelectionChange` 照常上报、`inputRef` 转发保留、ref 收敛为 `replaceCommittedText(text, cursor?)`（原语义：只提升新增片段内的完整 token——手输即时高亮后无「提升」概念，退化为纯文本写入+光标合成，行为等价）；移除 `replaceActiveAt`/`useMentions`/nativeTruthRef/emitMentionValue/promotePlainMentions 全链 |
| 5 | `src/components/chat/ChatComposer.tsx` | `replaceActiveAt` 分支删除，typeahead 点选统一走 `buildTokenInsertion + replaceCommittedText`（现有 fallback 路径，已是行为等价实现；护栏见测试 T-INT 新增的 typeahead 点选用例） |
| 6 | `src/components/agent/PromptMacroTextInput.tsx` | 重写：overlay 化（复用变更 1 基础件 + `splitPromptMacroSegments`），`handleChangeText` 换 `tryAtomicRangeDelete(prev, next, findWhitelistMacroRanges(prev))`；props 契约（tokens/value/onChangeText/placeholder/style/selection/onSelectionChange）与内部 `pendingSelection ?? selection` 合并优先级语义保留、chips 插入行为不变；stack 容器复刻现由 `FormTextInput` 提供的表单外观（边框/圆角 12/背景/padding 14×12/fontSize 16，素材取 tokens） |
| 7 | `src/components/agent/prompt-macro-input.ts` | `tryAtomicMacroDelete` 改为泛化版薄封装（签名不变，13 用例原样守护）；其余不动 |
| 8 | `src/components/chat/composer-at-path-mention.ts` | 整文件删除（8 个值导出 + 2 个 type 导出的 src 消费方全部在 ComposerAtPathInput 内；`mentionValueToPlain` 经查无发送/草稿侧引用）；同步清理 `composer-at-path.ts:3` 头注释中指向本文件的一句话 |
| 9 | `apps/mobile/package.json` + 根 lockfile | 移除 `react-native-controlled-mentions@^3.1.0`（import 级引用仅 3 个代码文件，全在本迭代改动面内） |
| 10 | `__tests__/composer-at-path.test.tsx` | 删 L9 库 import；T-AT1 / T-AT2b 短路 / promotePlainMentions describe（3 块）删除；T-AT2 原子删段改 `tryAtomicRangeDelete` 断言、「手输不提升」与「手输退格不原子删」（L166-172）两类子断言随语义反转删除；v1.5.9 用例断言面从 children span 改高亮层 Text 树（新 helper `collectHighlightSegments` 接替 `hasMentionSpan`，判据 borderRadius===6——若 Step 1 拍板降级档位则同步调整判据）；T-SC1 / replaceCommittedText / core 纯函数 8 例保留；新增 T-HL/T-AD |
| 11 | `__tests__/chat-composer.integration.test.tsx` | `composerChildrenPartTexts` 重写为高亮层 Text 段提取（`findNativeComposerInput` 逻辑保留、注释更新）；T-CR4① 重生为「程序化写入 → 模拟原生 onChangeText 续打 → 断言 value 恒 plain + 高亮层 token 段幸存」；T-CR4② 重生为「程序化写入 → 续打 → 再次程序化写入」序列，断言两次插入的多 token 段独立幸存、plain 合并正确（原 truth 清空语义随架构消失，以多 token 序列断言重生）；markup 构造（`formatAtPathMentionMarkup`/`mentionValueToPlain` 对账）全部改 plain 字面量；其余 13 用例不动 |
| 12 | `__tests__/prompt-macro-text-input.test.tsx` | value+children 互斥守门改 overlay 渲染守门 + 高亮段断言 |
| 13 | `CHANGELOG.md` | Unreleased 段补条目（移动端输入框引用 tag 改 overlay 高亮、打字闪烁根治、手输即时高亮、依赖摘除） |

## 详细实现步骤

- Step 1 — phase-overlay-spike — blocking: yes — qa: manual_user：worktree 内做模拟器 spike（临时调试入口，代码不随 PR 合入，结论记入本迭代 `docs/Iterations/composer-overlay/spike-notes.md`）。四点验证：① TextInput multiline `onScroll` → 高亮层 ScrollView 同步（iOS throttle / Android 打字跟随滚动是否派发）；② 普通 Text 树胶囊 `borderRadius+backgroundColor` 在 Android 是否生效 + 水平负 margin 是否可用；③ 尾随 `\n` 的 Text 行高占位（不占则补零宽占位）；④ 透明 `color` 下 IME 组合下划线/组合文本可见性（模拟器 Gboard 拼音）。产出：滚动同步方案（a/b）与胶囊档位拍板，写入 spike-notes。
- Step 2 — phase-highlight-core — blocking: yes — qa: auto：落地变更 2/3 纯函数 + `atomic-range-delete.test.ts` / `composer-highlight.test.ts`（T-AD/T-HL 全量）；`prompt-macro-input.ts` 换泛化封装后跑既有 13 用例确认等价。
- Step 3 — phase-overlay-infra — blocking: yes — qa: auto：落地变更 1（按 Step 1 拍板方案）+ `overlay-input.test.tsx`（T-OV：高亮层 pointerEvents none、TextInput 透明色、两层 metrics 一致断言）。
- Step 4 — phase-chat-overlay — blocking: yes — qa: auto：落地变更 4/5 + 迁移测试 10/11（T-CR4①② 重生、v1.5.9 断言面迁移、`composer-at-path.test.tsx` 全绿）。
- Step 5 — phase-macro-overlay — blocking: yes — qa: auto：落地变更 6/7 + 迁移测试 12；`agent-editor-form-delete-confirm.test.tsx`（已 mock）确认不受影响。
- Step 6 — phase-cleanup — blocking: yes — qa: auto：变更 8/9（删文件含 `composer-at-path.ts` 头注释清理、移依赖、lockfile 更新）+ 全仓 grep 残留引用为零（import 与注释都算）+ `npx knip` 复核（非门禁，记录结果）+ CHANGELOG（变更 13）。
- Step 7 — phase-verify — blocking: yes — qa: manual_user：`npm run typecheck` + `apps/mobile` jest 全量（基线：通过数不降，既有红灯 `mermaid-fullscreen.test.ts` 不变，参照 binary-blob-and-vfs-pack 1534/1535 口径）；模拟器验收 A1–A6/A8（复用 2026-09-28 复查轮的录屏+帧差脚本思路：逐字符注入、帧差统计、tag 区域肉眼与帧对检查；**A8 场景含「长文宏编辑挂载置顶后高亮层与输入层视口对齐」**——挂载置顶的滚动事件链是 overlay 双层同步最脆弱时刻）+ e2e `getComposerText` 顺带回归；验收后更新 `docs/apm/RULE.md:21` 条目（闪烁问题关闭）。

## 测试策略

原则：纯函数为主断言面（借桌面 `Step5/Step20` 形态：断言 segments 数组精确集合而非渲染 HTML）；组件层断言对外契约与高亮层 Text 树；行为底线（1.5.9/1.5.10）以「组合态 onChangeText 序列」jest 模拟守护——新架构该路径零变换，用例同时防回归与防实现走样。

### 测试用例

- T-HL1..6 — blocking: yes — `splitComposerTokenSegments`：`$apm-recall` 与 `@/a.md` 混排精确分段；`@a$b` 互斥不互吞；孤立 `$` 不成 token 原文保留；`a@b` 无前置空白仍命中（桌面口径）；空串/纯文本原样；token 邻接边界。（Step 2）
- T-AD1..5 — blocking: yes — `tryAtomicRangeDelete`：区间内退格整段删；非删除返回 null；多处不连续删返回 null；删除已覆盖整段返回 null；chat token ranges 与宏 ranges 双源等价（含 T-M3/T-M4 语义回归）。（Step 2）
- T-OV1..3 — blocking: yes — overlay 骨架：高亮层 `pointerEvents='none'`；TextInput `color==='transparent'` 且 `selectionColor===tokens.selection`；两层 fontSize/lineHeight/padding 与传入 metrics 逐项一致。（Step 3）
- T-CR-HL1..3 — blocking: yes — chat 高亮层：水化 `value` 含 token 时高亮段恢复（A5 jest 形态）；手输序列即时命中/删除到不命中即时还原（A2 jest 形态）；程序化写入→续打→token 段幸存（T-CR4① 重生，含 value 恒 plain 断言）。（Step 4）
- T-IME1..2 — blocking: yes — 组合态序列（v1.5.9 用例迁移）：模拟 `onChangeText` 连续上报（含部分拼音串）后 `value` 与最后上报严格相等、不丢字；带 token 长文续打 value 恒 plain（v1.5.10 底线）。（Step 4）
- T-CR1/2 — blocking: yes — 保留：T-SC1 selection 契约、replaceCommittedText 光标合成（现用例语义迁移）。（Step 4）
- T-INT — blocking: yes — `chat-composer.integration.test.tsx`：13 例原样 + T-CR4①② 重生后全绿；**新增 1 例 typeahead 点选护栏**（mock `AtPathTypeahead`/`SkillTypeahead` 的 onSelect → 断言插入为 plain 文本 + 补尾空格 + 光标落位 + 高亮层 token 段更新）——覆盖变更 5 `replaceActiveAt` 移除后的单路径化。（Step 4）
- T-MAC1..2 — blocking: yes — 宏 overlay：渲染守门（value 字符串直控不抛）；`{{$time}}` 高亮段断言、非白名单/未闭合不高亮（复用 splitPromptMacroSegments 语义）。（Step 5）
- T-MAC3 — blocking: yes — `prompt-macro-input.test.ts` 13 用例全量原样通过（其中 6 例为原子删守护）。（Step 2/5）
- T-MAC4 — blocking: yes — 长文 value + 外部 `selection={0}` 挂载渲染不抛、高亮段完整（ExpandablePromptInput 挂载置顶路径不破坏双层渲染）。（Step 5）
- T-DEP1 — blocking: yes — 全仓无 `react-native-controlled-mentions`/`composer-at-path-mention` import（grep 断言）；`apps/mobile/package.json` 无该依赖。（Step 6）
- A1–A8（PRD 验收）— qa: manual_user — Step 7 模拟器执行并留录屏证据。

## 兼容性或迁移说明

- 对外契约零变更：ChatComposer/发送链路/草稿/e2e（`~chat-composer-input` setValue/getText）无感；`ExpandablePromptInput` 的挂载置顶机制（selection 短暂受控）原样保留，仅验证初始视口对齐。
- 行为变更（PRD 拍板项，非兼容目标）：手输 token 即时高亮（旧「手输不成 tag」语义反转）；`replaceActiveAt` ref 方法移除（内部单路径化，ChatComposer 同步改造）。
- `RULE.md:21` 条目在 Step 7 验收通过后改写为「已根治（本迭代），overlay 架构」。

## 风险与回滚方案

| 风险 | 缓解/备选 | 回滚 |
|---|---|---|
| TextInput onScroll 不派发（Android 打字跟随滚动） | Step 1 spike 前置；备选方案 b 单滚动域（scrollEnabled=false + 外层 ScrollView） | Step 级独立提交，每 phase 可单独 revert |
| RN Text 水平负 margin 不可用 → 换行点漂移（历史 R1 根因） | 胶囊档位保底 `paddingHorizontal:0`（测量零漂移）；spike 以「换行点与纯文本一致」为准绳 | 同上 |
| 透明 color 下 IME 组合下划线不可见 | Step 1 spike ④ 验证；不可见则评估 Android 侧接受度（组合中不可见、上屏可见为底线）或局部不透明策略 | 同上 |
| 受控 value 打断 IME 组合 | value 恒等回写（无变换）+ T-IME1/2 组合态序列守护；jest 与模拟器双层验证 | 同上 |
| Text 树胶囊跨行断口（无 box-decoration-break 等价物） | 罕见场景（token 跨行）；spike 观察，不可接受则接受现状级瑕疵（不阻塞验收） | 同上 |
| 整体验收不过 | — | feature 分支整体 revert，旧实现完整在 git 历史； RULE.md 条目保持「择期」不变 |

全量回滚边界：本迭代不触 core 与桌面，回滚零外溢。
