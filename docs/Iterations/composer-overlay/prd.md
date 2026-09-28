---
date: 2026-09-28
dependency: []
---

# 移动端输入框 overlay 高亮重写 PRD

## 背景

移动端聊天输入框（`ComposerAtPathInput`）的 `$技能`/`@路径` tag 胶囊由 `react-native-controlled-mentions` 渲染在 TextInput 的 children 里。该架构下每敲一键库都会全量重推 children 元素树，Android 侧重建 EditText 的 spannable，多行文本全量重排重绘，产生打字闪烁。

- 2026-08 `ux-fixes-2026-08` 迭代已定案（`docs/apm/RULE.md:21`）：闪烁与打字刷新在该架构下绑死，「children 复用」「库内短路」两条修复路真机验证均致 tag 消失，勿重试；用户拍板择期修复。
- 2026-09-28 复查轮确认：RN 生态无可替代库（同类全同构），fork 库修不了架构死结；根治方向是 overlay（透明输入 + 外部高亮层），桌面端已是生产验证的同款蓝本（`apps/desktop/renderer/features/chat/ComposerAtPathInput.tsx`，透明 textarea + onScroll 同步 + 负 margin 保测量一致）。
- 宏输入框（`PromptMacroTextInput`）与聊天输入框同为 children 着色架构，本次一并重写。

用户拍板（2026-09-28）：手输即时高亮（对齐桌面语义）；tag 统一真胶囊（Android 圆角不可用则降级方角）；闪烁验收以模拟器为准；范围含宏输入框。

## 目标（含成功指标）

1. **打字零闪烁**：多行混排 tag 连续输入时 tag 与正文无每键闪烁/跳动（模拟器目测 + 录屏帧差可判定）。
2. **手输即时高亮**：正则命中的 `@路径`/`$技能`/宏 token 即时渲染为胶囊（对齐桌面），不再区分「手输/程序化插入」两种形态。
3. **胶囊视觉统一**：双端统一「主题色字 + 淡底 + 圆角」真胶囊；Android 若普通 Text 树圆角背景不可用，降级为方角淡底，不牺牲字色。
4. **依赖摘除**：移除 `react-native-controlled-mentions`，消除每键 2 次全文 parseValue + diffChars 的 JS 开销。

成功指标：闪烁消除（验收环境=模拟器）、`apps/mobile/package.json` 不再含该依赖、测试迁移后全绿。

## 用户与场景

移动端用户在聊天输入框与宏编辑输入框输入含引用 token 的多行长文本。关键场景：

- 引用技能/文件后继续输入长文（原闪烁主场景）；
- 中文 IME 组合态连打/删字（1.5.9「打字变删除」、1.5.10「tag 降级普通文本」两案回归风险区）；
- typeahead 点选、@选择器/SkillPicker 程序化插入；
- 退出会话重进恢复草稿（水化后 tag 高亮恢复）。

## 范围

### 包含范围

- `apps/mobile` 的 `ComposerAtPathInput.tsx`（聊天输入框）与 `PromptMacroTextInput.tsx`（宏输入）改为「透明 TextInput + 外部高亮层 overlay」；
- 两组件共享的 overlay 基础设施（高亮层渲染、滚动同步、胶囊样式）；
- 原子删除改为 plain 版实现（保留「退格进 tag 整段删」的对外行为，桌面宏 `tryAtomicMacroDelete` 为蓝本）；
- 相关测试迁移：库 children 结构断言类测试改测高亮层渲染与对外契约；
- 移除 `react-native-controlled-mentions` 依赖与 `composer-at-path-mention.ts` 中随之作废的 markup 逻辑。

### 不包含范围

- 桌面端（已是 overlay，无此问题）；
- typeahead 弹层交互逻辑、候选排序（驱动接口不变）；
- 发送链路与 core 附件扫描正则（`scan-at-path-attachments` 等不动；高亮边界语义取桌面口径——`@`/`$` 互斥不互吞、token 前无空白要求，展示层宽于发送识别层属预期，与桌面现状一致）；
- 聊天输入框之外的其他 children 着色场景（如有）。

## 核心需求（3-7 条）

1. **overlay 架构替换**：两组件改为「流内高亮层定尺寸 + 透明文字 TextInput 覆盖其上」，光标/placeholder/IME 交互全在 TextInput，高亮层纯视觉（不可交互）；打字时高亮层重绘不得引起输入层原生渲染扰动。
2. **手输即时高亮**：高亮层无状态按正则切分（`@` 与 `$` 字符类互斥、互不吞并，桌面 `AT_TOKEN_RE` 口径），命中即胶囊，不维护 markup 状态。
3. **胶囊视觉统一**：主题色字 + 13% 透明度底 + 圆角 6 + 横向 padding 3；Android 真机/模拟器验证普通 Text 树圆角不可用时降级方角。
4. **原子删除保留**：退格进入 token 区间整段删除（plain 版 diff + 区间命中实现）。注意一处预期行为变更：手输 token 的退格从现状「逐字删」变为「整段删」（手输即时高亮的自然推论，与宏输入现状同款语义）。
5. **对外契约不变**：`value`/`onChangeText` 恒为展示 plain；`onSelectionChange` 照常每次选区变化回调（typeahead 开合依赖）；ref 方法（`replaceCommittedText`、`replaceActiveAt` 或收敛后的等价签名）语义不变；`testID` 直通原生 TextInput；样式口径（min 56 / max 160 / fontSize 16 / lineHeight 22）不变。
6. **既有对外行为不回归**：草稿水化后 token 高亮恢复；发送正文为纯 plain、发送后清空；1.5.9（IME 组合期不丢字）与 1.5.10（打字不降级 tag）两案的对外表现保持（机制可换，行为底线不可破）。
7. **依赖与死代码清理**：移除 `react-native-controlled-mentions`；`composer-at-path-mention.ts` 仅保留仍有消费方的纯函数（如 `mentionValueToPlain` 若发送/草稿侧仍引用），markup 提升类逻辑（`promotePlainMentions`/`mergeProgrammaticPlainIntoMentionValue`）随状态制拆除。

## 验收标准

| # | Given / When / Then |
|---|---|
| A1 | G：输入框已有 `$技能` tag 与多行正文；W：模拟器连续输入文字（逐字符 + 整词注入）；T：tag 与正文无肉眼闪烁/跳动，录屏帧差无可感知的样式跳变帧对。 |
| A2 | G：输入框聚焦；W：手输 `@src/x` 与 `$apm-recall`；T：输入过程中 token 即时渲染为胶囊，删除到不再命中时即时还原为普通文本色。 |
| A3 | G：输入框内有完整 tag；W：光标置于 tag 区间内按退格；T：整段 token 一次删除（含尾随空格语义与现状一致）。 |
| A4 | G：光标在 `@qu` 查询态；W：typeahead 点选候选 / @选择器与 SkillPicker 程序化插入；T：tag 插入 + 补尾空格 + 光标落位与现状语义一致，高亮层同步更新。 |
| A5 | G：草稿含 token；W：退出会话重进（水化路径）；T：正文恢复且 token 全部高亮，光标 clamp 正确。 |
| A6 | G：输入框含 tag 与正文；W：发送；T：发送正文为纯 plain 文本，输入框清空、草稿清除。 |
| A7 | G：中文 IME 组合态；W：含 tag 长文连打与删字；T：不丢字、不串位、tag 不降级为普通文本（jest 行为测试保持通过）。 |
| A8 | G：宏编辑页；W：输入宏 token；T：宏高亮照常（规则与现状一致，仅渲染层更换），多行长文打字无闪烁。 |
| A9 | W：`apps/mobile` jest 全量跑；T：不依赖库的纯函数测试（composer-token-insert 6 / chat-composer-draft 5 / core composer-at-path 7 等）原样通过；库耦合测试按语义迁移至高亮层断言后全绿。 |

## 风险与待确认项

1. **滚动同步**：RN TextInput 的 onScroll 同步高亮层滚动在仓库无先例（iOS 需 scrollEventThrottle；Android 打字自动跟随滚动是否派发 onScroll 未验证）——SPEC 阶段前置小验证，不通过则启用备选（单滚动域共用 ScrollView 或封顶后外层容器接管）。
2. **胶囊宽度与换行点测量一致性**：桌面负 margin 抵消 padding 的手法在 RN 嵌套 Text 无先例；若不可移植，备选为胶囊不加横向 padding（保换行点一致）或接受与纯文本的轻微换行差异——需在验证后拍板，历史上此处曾引发高度跳变（ux-fixes-2026-08 R1 根因）。
3. **Android 普通 Text 树圆角背景**：TextInput children 内不生效是已证限制，普通 Text 树未验证——PRD 已定降级预案（方角淡底）。
4. **尾随换行高度占位**：桌面靠 `<br/>` 防末行换行高度丢失，RN Text 对尾随 `\n` 的占位行为需验证。
5. **透明色下 IME 组合下划线可见性**：透明的是文字 color，组合态装饰（下划线）理论上不受影响，需模拟器确认。
