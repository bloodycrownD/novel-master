# CR Fix Spec: taf-preview-flash 迭代收尾修补（typeahead 移除链 + 白闪修复族）

## 元信息
- repo / 分支：D:\worktree\taf @ feat/taf-preview-flash（实现仓）；本文件在主仓 D:\Dev\Js\novel-master
- base_sha / head_sha：615dda436 / 3fd4ef398
- prd_path：docs/Iterations/composer-typeahead-remove-preview-flash-2026-10/prd.md
- spec_path：docs/Iterations/composer-typeahead-remove-preview-flash-2026-10/spec.md（含补篇 1-3）
- review_round：2（wave1: review-scope-typeahead + review-scope-flash 并行；wave2: review-full 校验+裁决）
- dag_version：3（v1=两 scope 拆解；v2=round1 5 条 P2 落盘；v3=round2 增补 3 条 P2 + 修正 2 处改法措辞）
- 状态：fix-spec-ready（待用户确认开工）

## Must-fix（按 P0 → P1 → P2；本轮 P0=P1=0，P2×8；全部零行为面——7 条纯注释/措辞 + 1 条补测试）

### typeahead/C-1 [P2] ChatConversationPanel 头注释仍列已删除的「候选源拉取」
- 维度：C
- 文件：apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx（:160）
- 问题：组件头注释把「候选源拉取」列为 controller 职责，该链本次已整体删除（controller 自身头注释已同步，本文件没跟上）。
- 改法：`草稿链 / 候选源拉取 / Picker 状态机 / 发送决策照旧运转` → `草稿链 / Picker 状态机 / 发送决策照旧运转`。
- 验收/测试：`候选源` 在 apps/mobile/src 下零命中（findstr 核对）；jest 相关套件绿（纯注释改动）。
- 来源：review-scope-typeahead / round 1

### typeahead/G-1 [P2] T-TR3 浮层残留探针未覆盖 @ 支路（无 testID 形态复辟不会红）
- 维度：G
- 文件：apps/mobile/__tests__/prompt-editor-screen.test.tsx（:218-225 findTypeaheadNodes）
- 问题：探针只匹配 testID 含 `typeahead`；历史 @ 浮层（AtPathTypeahead）本就无 testID（只有 accessibilityLabel「文件路径建议/技能建议」），@ 侧实际未被兜住——仅剩「组件已删」的编译期保证。
- 改法（二选一，倾向前者）：探针匹配条件扩为 `(typeof testID==='string' && testID.includes('typeahead')) || (typeof accessibilityLabel==='string' && accessibilityLabel.endsWith('建议'))`；若不扩，把注释改为「@ 行历史无 testID，本探针只兜 skill 行」的边界说明。
- 验收/测试：临时塞一个 `accessibilityLabel='文件路径建议'` 节点时探针应命中（自验后移除）；prompt-editor-screen 套件绿。round2 已核实「建议」a11y 标签当前树上零误报源。
- 来源：review-scope-typeahead / round 1

### flash/C-1 [P2] rich-document bootstrap 注释未同步 fix-D hash 口径
- 维度：C
- 文件：apps/mobile/src/web/rich-document/index.html（head 注释块，:9-13）
- 问题：三份同族 bootstrap 中 chat-transcript/code-editor 注释已带 fix-D 口径（hash 全平台保留、query 会被部分 WebView 丢弃、丢失由 RN 侧 B 注入兜底），唯独 rich-document 仍是 C′ 轮「query/hash 读参 + iOS 丢 query 由 B 兜底」旧口径——丢掉了本族根因演进的关键结论。
- 改法（round2 修正：**口径对齐，不逐字复制**——chat-transcript 注释含本包不适用的事实）：更新注释为「fix-D 2026-10-18：优先 hash 形态（`#bg=`，hash 全平台保留；`file://`+query 会被部分 WebView 实现丢弃）；参数丢失时由 RN 侧 B（injectedJavaScriptBeforeContentLoaded）注入兜底」，**保留 rich-document 自己的 CSS 出处与首绘竞态描述**（本包兜底出处是 `html,body{background:var(--bg,#fff)}` / document.css，白帧是首绘帧自己画的）。
- 验收/测试：**web 资产改动**——须跑 `build:webview:native` 重建三根产物（webview-dist/android assets/ios WebViewDist），webview-asset-guard 门禁绿；三个 boot-script 契约测绿；人工 diff 三份注释口径一致（口径=fix-D 日期+hash 理由+B 兜底，非逐字）。
- 来源：review-scope-flash / round 1；round 2 修正改法

### flash/C-2 [P2] CodeEditorWebView 悬空 JSDoc 残渣（fix-D 抽取遗留）
- 维度：C
- 文件：apps/mobile/src/components/vfs/CodeEditorWebView.tsx（:72-76）
- 问题：孤立注释块「首帧主题预注入…buildThemeInjectScript 已抽到 …」夹在 themeFromTokens 与组件声明之间，是本地函数抽走后的残渣；同信息已在 :261 使用处与 webview-theme-inject.ts 头注释存在，三处冗余。
- 改法：整块删除（保留 :261 与单源模块两处即可）；若要留组件级说明，改写为一句真正描述组件的 JSDoc，不得重复单源渊源。
- 验收/测试：code-editor-webview 套件绿（T-PF3 不涉注释面）。
- 来源：review-scope-flash / round 1

### flash/G-1 [P2] fix-E 三点防线零自动化断言（删了 jest 不会红）
- 维度：G
- 文件：apps/mobile/src/navigation/RootNavigator.tsx、StackScreenLayout.tsx；新增 apps/mobile/__tests__/navigation-flash-fix.test.tsx
- 问题：navHost 外衬 + navigationTheme 对齐 + 屏根底色全为纯 JS 且全仓无这两个文件的测试（git grep 零命中），spec 补篇 3 亦未写测试用例；白闪族已四轮返工，无回归保护。
- 改法（零实现改动路径，推荐 1+2；3 可选）：
  1. 新增 `__tests__/navigation-flash-fix.test.tsx`：渲染 `<StackScreenLayout pageKey="About"><View /></StackScreenLayout>`，**mock 前提（round2 补）**：`@react-navigation/native`（useNavigation/useRoute）、`@/theme/ThemeProvider`（返回 `{tokens:{background:'#000'}, mode:'dark'}`）、**`@/components/chrome/AppHeader`（`jest.mock('@/components/chrome/AppHeader', () => ({AppHeader: () => null}))`——真实 AppHeader 调 useHeaderContext 无 Provider 即 throw，先例 composer-fullscreen.test.tsx:254）**；`StyleSheet.flatten` 断言根 View style 含 `backgroundColor:'#000'`（锚 #24）；
  2. 同文件按项目源码契约测惯例（readFileSync 断言源码文本，先例：rich-document-webview-annotate-menu.test.tsx:97-105）断言 RootNavigator.tsx 含 `styles.navHost` style 数组（`backgroundColor: tokens.background`）与 `theme={navigationTheme}`（锚 #22/#23）；
  3. （可选）把 navigationTheme 构造提为模块级导出纯函数（buildNavigationTheme(mode, background)），对 dark/light 断言 DarkTheme/DefaultTheme spread + background 覆写——需微型重构，不做不算缺口。
- 验收/测试：新测 jest 绿；现有实现行为零改动；`#bg=` 相关既有测全绿。
- 来源：review-scope-flash / round 1；round 2 补 mock 前提

### review-full/C-1 [P2] ChatConversationWebView 注释指向已删除的测试文件
- 维度：C
- 文件：apps/mobile/src/components/chat/ChatConversationWebView.tsx（:121-123）
- 问题：宣称 transcriptOnly 的 web 产物断言在 `__tests__/chat-conversation-boot-script.test.ts`——该文件已删（上一迭代），chat-transcript web 侧也已无 dock/transcriptOnly 消费。
- 改法：改为「transcriptOnly 的行为面断言在 `__tests__/chat-conversation-webview.test.tsx` 的 transcriptOnly describe（RN 侧 init 载荷 + memo 比较器）」。
- 验收/测试：`git grep chat-conversation-boot-script -- apps/mobile/src` 零命中；相关套件绿（纯注释）。
- 来源：review-full / round 2

### review-full/C-2 [P2] dock-style 注释引用已删除的对照面测试
- 维度：C
- 文件：apps/mobile/src/components/chat/native-composer/dock-style.ts（:20）
- 问题：「web 侧对照面仍由 chat-conversation-boot-script.test.ts 消费」——文件已删；实际消费方是 native-composer-dock.test.tsx。
- 改法：改为「对照面由 `__tests__/native-composer-dock.test.tsx` 消费（T-NC10 样式逐项 + T-CC-CSS-15 消费方守卫）；web 侧旧对照面随 chat-conversation web 包退役已删」。
- 验收/测试：同 review-full/C-1（grep 零命中 + 套件绿；纯注释）。
- 来源：review-full / round 2

### review-full/C-3 [P2] controller 头注释「两样东西」漏列现存职责（自 Q7 升级）
- 维度：C
- 文件：apps/mobile/src/components/chat/useChatComposerController.ts（:8-13）
- 问题：头注释称「留在本 hook 的是两样东西」，但该 hook 同时持有 Picker 状态机（pickerOpen/skillPickerOpen、confirm 回调，:161-176）与 token 插入/胶囊区间链（:630-685）；该句本轮恰好被改写，存量口径不完整。
- 改法：补全为「1 发送决策；2 草稿三订阅链；另有 Picker 状态机与 token 插入/胶囊区间维护」。
- 验收/测试：纯注释，套件绿。
- 来源：review-full / round 2（wave1 附录 Q7，回读代码确认后升级）

## Spec deviations
- none（round2 复核维持：typeahead 变更点 #1-#9 + T-TR1~T-TR5 全落实、红线保留项在位；flash 补篇 #13-#24 + T-PF1-PF8 全落实、九处产物均含 bootstrap；`canTypeahead→canOpenPicker` 条件表达式逐字一致属命名选择；iOS 未真机验为 spec 已记录边界）

## Open questions / 待拍板（round2 裁决后剩余，均不阻塞）
1. **flash-Q1 主题切换下 `#bg=` hash 变更的导航语义未实证（三宿主同机制）**：仅 fragment 不同的 loadUrl 预期 same-document 不重载；若被当整页重载，ChatConversationWebView 存在 ready no-op 悬挂链（:1281-1297 不重发 init）→ 空页。→ **已并入合并后 QA**（切主题真机探针，零成本）；若真机出现空页再升 P1 立修。
2. **flash-Q2 E 遮罩无失败反馈**：rich-document 无 ready 超时/onError（chat-transcript 有 8s 超时）。改动前亦无失败 UI，失败时可观察差异仅「系统错误页 → 主题色空区」，属产品决策待拍板；若拍板修，最小改法 onError 时 setWebReady(true) 或渲染失败态。
3. **flash-Q3 三份 bootstrap + 三处 `#bg=` 拼接手写重复**：web 包间无法 import，收敛需构建期注入；spec 已拍板三宿主各一条契约测锁形态（实测在案）。排期事务。
4. **flash-Q4 冷启动浅色窄窗**：ThemeProvider 初值 light，dark 用户冷启动可能有 tokens 浅色底一帧（既有窄窗，本次已从恒白改善为 tokens 值）。「loaded 前不渲染子树」是全局启动体验决策，待拍板。
5. **typeahead 注释残留簇（维持附录，round2 补漏）**：composer-token-insert.ts:2-3、native-composer/token-ranges.ts:55、CodeEditorBridge.ts:47、web/code-editor/webview/runtime/editor.ts:79、code-editor-bridge.test.ts:60、composer-fullscreen.test.tsx:438、composer-at-path.test.tsx:21、chat-tab-screen.integration.test.tsx:150-151（skills mock 勿直接删）、chat-transcript-entry.test.ts:4、composer-fullscreen.test.tsx:7、**ComposerInputWebView.tsx:6/92、src/web/composer-input/webview/runtime/editor.ts:9/478（web 侧注释若修需重建产物，成本收益不配，暂缓）**、README.md:239（chat-conversation 时代整段架构描述，应独立重写，不塞本轮）。全部零行为面。
6. **composer-at-path re-export 死出口**：`filterAtPathTypeaheadCandidates`/`formatComposerAtPathToken`/`replaceActiveAtWithToken` mobile 侧仅测试消费；spec 列为保留红线，独立技术债待办。

## 已豁免（用户确认不修）
- （空）

## 合并后 QA（manual_user）
- iOS 真机：三宿主 `#bg=` hash 传播 + bootstrap 生效验证（无环境，暂缓；设计上 B 注入兜底）。
- 暗色四场景真机复测（进会话/页签/预览进退/编辑器）——修补项落地后过一遍（白闪族主体已验：fix-E 轮 5×539 帧 0 混合白帧）。
- **flash-Q1 探针**：真机「会话屏停留 → 切主题（暗↔亮）→ 返回」观察是否空页/8s 错误态（三宿主同机制，任一屏验一次即可）；出现异常即回报升 P1。
- 修补轮改动全为注释/测试，行为面零改动，复测可从简（四场景 + 切主题探针）。

## K 节建议（下游执行时闭合）
- CHANGELOG.md 补本迭代条目（typeahead 移除 + 白闪族五轮；用户已验收，随本轮修补一并写）。
- C-1/C-2/C-3 家族纯注释改动与本轮其余项统一一轮 lint/format（下游执行轮跑，本 skill 不代跑）。
- **web 侧 index.html 注释若再动（flash/C-1）必须 `build:webview:native` 重建三根产物**（已在该条验收栏，此处再提避免执行轮漏跑）。
- 修补完成后 spec.md 补篇 3 后可追加一行「CR 轮修补记录」指向本文件（可选）。

## Fix-Spec Closure
| 项 | 状态 |
| fix-spec-ready | yes |
| fix_spec_path | docs/Iterations/composer-typeahead-remove-preview-flash-2026-10/cr-fix-spec.md |
| dag_version / review_round | 3 / 2 |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 0 / 8 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none |
| C-orch | ✅（两 scope + full 均查：三宿主 hash 形态一致、B 单源无分叉、typeahead 移除无平行残留入口；跨模块交界文件 round2 抽查无新问题） |
| C 类合并后 QA | 四场景复测 + 切主题探针 + iOS（暂缓） |
