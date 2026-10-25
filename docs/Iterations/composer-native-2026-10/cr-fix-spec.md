# CR Fix Spec: composer-native-2026-10 QA 修复轮

## 元信息
- repo：D:\Dev\nm-worktree\cn1（分支 feat/composer-native-2026-10）
- base_sha：5d3640d83（dev-ready head）/ head_sha：55ec67947
- prd_path / spec_path：docs/Iterations/composer-native-2026-10/spec.md
- review_round：1 / dag_version：1
- 状态：**fix-spec-ready**（2026-10-11 用户拍板：DEV-01/02/03 按现状收窄 spec（已同步三处文本）；补丁注释口径 = 纯中文）
- 审查范围澄清：base..head 共 11 笔提交，其中 QA 修复轮 4 笔为本 fix-spec 对象；merge main 带入的 3 笔（v1.5.40 主线）不在此列

## Must-fix（按 P0 → P1 → P2）

### CR-fix-01 [P0] Kotlin 补丁新增注释全英文
- 维度：F
- 文件：patches/react-native-enriched-markdown+1.1.1.patch（View.kt:283-291,400-402,1132-1137,1150-1156；Manager.kt:250-255；InputMeasurementStore.kt:19-20,117-119；RoundedBackgroundSpan.kt:71-73）
- 问题：本轮新增/改写的注释块（拖滚 onTouchEvent、scrollTo 归零、lineSpacingAddPx/setPendingLineHeightDp KDoc、setLineHeight 补偿、MeasurementStore 缓存键/initialMeasure、draw drawText）全英文，与同补丁内既有中文注释（setTokenRanges/RoundedBackgroundSpan 类注释）混用
- 改法：逐块译为中文（KDoc `/** */`、行内 `//`）；在 node_modules 改源后 `npx patch-package react-native-enriched-markdown` 重新生成补丁
- 验收：补丁内本轮新增注释块 0 英文；7 个目标文件 hash 与补丁 post-image 一致（保持同步性）；compileDebugKotlin 零错
- 来源：review round 1

### CR-fix-02 [P1] lineHeight 回落路径缺失（改回 0 时行距不回退）
- 维度：B
- 文件：补丁 → EnrichedMarkdownTextInputManager.kt（setLineHeight ~:244-258）、EnrichedMarkdownTextInputView.kt（setPendingLineHeightDp / applyPendingLineSpacing ~:1140-1149）
- 问题：Manager 侧 `if (value > 0 && view != null)` 门禁导致 lineHeight 改回 0/删除 prop 时 pendingLineHeightDp 保留旧值；applyPendingLineSpacing 的 `<= 0f` 分支直接 return，已应用的 setLineSpacing 不清除、不 invalidateLayout，测量缓存键残留
- 改法：门禁下沉到 View——Manager 无条件 `view.setPendingLineHeightDp(value)`；View 内赋值后调 applyPendingLineSpacing；其 `<= 0f` 分支改为 `setLineSpacing(0f, 1f)`（非 return）；setPendingLineHeightDp 末尾保留 invalidateLayout()
- 验收：compileDebugKotlin 零错；真机 QA「动态改 lineHeight prop 回落」行距回正（manual_user）
- 来源：review round 1

### CR-fix-03 [P1] 行距增量公式两处实现、输入不同源
- 维度：C（DRY）+ C-orch（同语义双信号）
- 文件：补丁 → EnrichedMarkdownTextInputView.kt:1158-1164（lineSpacingAddPx）、InputMeasurementStore.kt:117-134（initialMeasure 内联重算）
- 问题：测量同源化留了尾巴——View 路径读 view.paint（真实 fontMetrics），initialMeasure 用 AppCompatEditText 默认字体 paint + props fontSize；自定义 fontFamily/fontWeight 时冷启动测量与渲染仍差一行
- 改法：抽 `internal fun lineSpacingAddFrom(paint: TextPaint, lineHeightDp: Float, density: Float): Float`（放 InputMeasurementStore 或新建 input/layout/LineSpacing.kt），View getter 与 initialMeasure 共用；initialMeasure 的 paint 按 props fontFamily/fontWeight 构造（ReactTypefaceUtils.applyStyles，与库内其他 props 口径一致），取不到时注明差异
- 验收：compileDebugKotlin 零错；真机冷启动首帧与 store 后测量差 ≤ 1px（manual_user）
- 来源：review round 1

### CR-fix-04 [P1] controller 侧胶囊确认制四咽喉点零测试
- 维度：G
- 文件：apps/mobile/__tests__/use-chat-composer-controller.test.tsx
- 问题：useChatComposerController.ts +60 行（advanceTokenRanges/tokenRanges state/打字·插入·水化·清空四咽喉点），测试文件本轮零改动；controller 突变无测试会红
- 改法：补 4 条断言：① onChangeText 打字后 tokenRanges 差分重映射正确；② Picker 路径用例（:464/:489）加 tokenRanges 含新登记区间；③ rerender 换 sessionId 后 tokenRanges 重扫；④ 发送/清空后 tokenRanges 归空
- 验收：4 条绿 + 变异自检（注释掉任一咽喉点必红）
- 来源：review round 1

### CR-fix-05 [P1] 真机白屏根因层（v2→v1 下译）零测试
- 维度：G
- 文件：apps/mobile/src/web/chat-transcript/webview/main.ts、apps/mobile/__tests__/chat-transcript-entry.test.ts
- 问题：3d206251e 修的白屏根因（runtime 只认 v1 信封 + 入口下译）无测试锁定；rawDowntranslate 是模块私有函数不可测；改回 V=1 或删下译层测试全绿
- 改法：rawDowntranslate 提为具名导出（新文件 host-downtranslate.ts，main.ts 只 import），单测覆盖：v2 字符串信封 → handleHostMessage 收到 {v:1,type,payload}；非 v2/坏 JSON/非对象 → 丢弃不调；chat-transcript-entry.test.ts 加 T-TS1e 同款源面断言锁 bindHostMessageChannel(rawDowntranslate) 与 createTranscriptRuntime({bindChannel:false, emitReady:false})
- 验收：变异自检——TRANSCRIPT_ENTRY_BRIDGE_V 临时改 1，新断言必红
- 来源：review round 1

### CR-fix-06 [P1] 每键两次 setTokenRanges 原生全量重格式化
- 维度：E
- 文件：apps/mobile/src/components/chat/NativeChatComposer.tsx（prop 收敛 effect ~:478-484）
- 问题：controller 每键产出新数组身份 → 收敛 effect 每键重跑 → 与 handleChangeText 本地 dispatch 形成第二次 removeType+addRange+applyFormatting（span 全删重加）；打字是最热路径，目标机低端荣耀 Android 12
- 改法：effect 内内容相等短路——prev 与 tokenRanges 逐项相等（length + start/end）时只更新 confirmedRangesRef.current、不 dispatch
- 验收：native-composer.test.tsx 加断言：rerender 传内容相同 tokenRanges 后 mockCalls.setTokenRanges.length 不增长
- 来源：review round 1

### CR-fix-07 [P2] typeface 变化后未重算 lineSpacing
- 维度：B
- 文件：补丁 → EnrichedMarkdownTextInputView.kt:1197-1212（updateTypeface）
- 问题：updateTypeface() 只设 paint.typeface + invalidateLayout，未重算行距补偿；fontFamily/fontWeight prop 晚于 lineHeight 到达时补偿基于旧字体——「顺序无关」只覆盖了字号
- 改法：updateTypeface() 内 paint.typeface 赋值后补 applyPendingLineSpacing()
- 验收：compileDebugKotlin 零错；真机切换 fontFamily/fontWeight 行距仍落目标值（manual_user）
- 来源：review round 1

### CR-fix-08 [P2] main.ts 头注释与实现矛盾（过期文档）
- 维度：C / K
- 文件：apps/mobile/src/web/chat-transcript/webview/main.ts:1-27
- 问题：头注释仍写「runtime 自绑宿主 message 通道（bindChannel: true）」，实现已改「入口先绑 + v2→v1 下译 + bindChannel:false」；入口契约测靠读源码文本，过期注释误导后续 agent 与测试可信度
- 改法：重写头注释 4-8 行为「本入口自行 bindHostMessageChannel(rawDowntranslate) 承接 v2→v1 下译，runtime 以 bindChannel:false 装配；ready 发言权仍归本入口」
- 验收：注释与代码一致 + T-TS1e 断言仍绿
- 来源：review round 1

### CR-fix-09 [P2] 拖滚手势结束后未解除父容器拦截
- 维度：B
- 文件：补丁 → EnrichedMarkdownTextInputView.kt（onTouchEvent ACTION_UP/CANCEL ~:343-353）
- 问题：拖滚激活时 requestDisallowInterceptTouchEvent(true)，UP/CANCEL 只复位 dragScrollActive，未还 false——父容器拦截状态悬挂
- 改法：dragScrollActive = false 后补 parent?.requestDisallowInterceptTouchEvent(false)
- 验收：compileDebugKotlin 零错；真机长草稿态拖滚后转录列表仍可正常滚动（manual_user）
- 来源：review round 1

### CR-fix-10 [P2] rawDowntranslate 用 any
- 维度：C
- 文件：apps/mobile/src/web/chat-transcript/webview/main.ts:60-82
- 问题：`let env: any = raw;` 绕过类型纪律；web 侧 esbuild 链无 lint 兜底
- 改法：改 unknown + 具名收窄（typeof 判 string → safeParse；env == null / typeof !== 'object' / 缺 v/type 字段 → return）
- 验收：mobile tsc 0 错 + build:webview 过
- 来源：review round 1

### CR-fix-11 [P2] synthesizeTokenMarkdownFromRanges 区间守卫不完整
- 维度：B
- 文件：apps/mobile/src/components/chat/native-composer/token-ranges.ts:135
- 问题：只查 start < cursor 与 end > text.length，不查 start < 0 与 end < start；负 start 让 slice(cursor, -1) 按 from-end 切出错拼文本（当前上游数学上不产出非法区间，纯防御缺口）
- 改法：守卫改 `if (range.start < 0 || range.end < range.start || range.end > text.length || range.start < cursor) continue;`；native-composer.test.tsx 补一条非法区间被跳过的单测
- 验收：新单测绿
- 来源：review round 1

### CR-fix-12 [P2] 信封版本常量两份（C-orch）
- 维度：C-orch
- 文件：apps/mobile/src/web/chat-transcript/webview/main.ts:44
- 问题：TRANSCRIPT_RUNTIME_BRIDGE_V = 1 手抄了 runtime/state/state.ts 的 BRIDGE_V = 1；v1 契约单一语义两处字面量
- 改法：从 @web/chat-transcript/webview/runtime/state/state import BRIDGE_V 直接用（可保留 `const TRANSCRIPT_RUNTIME_BRIDGE_V = BRIDGE_V` 供源面断言寻址）
- 验收：build:webview 过 + T-TS1e 源面断言仍绿
- 来源：review round 1

## Spec deviations
- DEV-01 [fixed] D7 高度链契约：spec 已按现状收窄（scrollEnabled={inputClamped} 封顶态动态切 + View 触摸拖滚补丁，2026-10-11 用户拍板「按现状收窄」）
- DEV-02 [fixed] D2 胶囊数值：spec 已改 cornerRadius=8dp（2026-10-11 用户拍板）
- DEV-03 [fixed] D2 胶囊纵向定界：spec 已改按字形 ascent/descent 贴边定界（2026-10-11 用户拍板）

## Fix-Spec Closure
| 项 | 状态 |
|---|---|
| fix-spec-ready | yes |
| fix_spec_path | docs/Iterations/composer-native-2026-10/cr-fix-spec.md |
| dag_version / review_round | 1 / 1（diff 模式单轮） |
| P0 / P1 / P2（已写入 fix-spec） | 1 / 5 / 6 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none（三处已收窄同步） |
| C-orch | ✅（CR-fix-03 双信号、CR-fix-12 常量两份） |
| C 类合并后 QA | 见「合并后 QA」节（4 项 manual_user，不阻塞） |

## Open questions / 待拍板
1. ~~上游化与中文注释张力~~ **已拍板（2026-10-11）：纯中文**，将来真上游化时再翻译
2. RoundedBackgroundSpan 左右 padding 几何不对称（8dp vs 4dp，diff 外既有，真机未反馈）→ 不进 must-fix，随下一轮真机 QA 观察
3. 拖滚无障碍兼容（TalkBack/长按选择）缺真机验证记录 → manual_user
4. main merge 带入的 3 笔（v1.5.40 主线）不在本 fix-spec 范围
5. android/generated codegen 重生成行为：建议 CI 侧确认一次「干净 checkout + npm ci + assembleDebug」链路
6. typeahead 落点紧贴既有胶囊边界：建议真机验证一次「候选插到胶囊旁」

## 已豁免（用户确认不修）
（无）

## 合并后 QA（manual_user）
- CR-fix-02：动态改 lineHeight prop 回落，行距回正
- CR-fix-03：自定义 fontFamily 冷启动测量与渲染差 ≤ 1px
- CR-fix-07：真机切换 fontFamily/fontWeight 行距落目标值
- CR-fix-09：长草稿拖滚后转录列表正常滚动
- open_questions 3：TalkBack/长按选择在拖滚下的兼容性

## K 节建议（下游执行时闭合）
- CR-fix-08 头注释同步（本表已含）
- 修完后跑一次 patch-package 重新生成 + 7 目标文件 hash 对照（CR-fix-01 验收内含）
