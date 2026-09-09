---
date: 2026-09-08
---

# 桌面端回归问题修复 技术规格（SPEC）

## 设计目标

修复 `prd.md`（bug 记录表）登记的必修缺陷：D-1、D-4、D-7、D-8、D-9、D-11、D-12、D-15，并以 `scripts/e2e/` 回归资产逐条复验。D-2（发送失败反馈）依赖用户方向拍板，不在本 spec 范围；待定性条目 D-5/D-6/D-13/D-14 的定性动作随复验批次顺带完成。

**修复口径**（PRD 已拍板）：登记缺陷全部必修；修复顺序按影响面与实现依赖排。工作目录：`.worktree/desktop-regression-fixes/`（branch fix/desktop-regression-fixes，基于 dev v1.5.13 + cherry-pick e2e 资产两提交），完成后并入 dev（见项目规则）。

## 总体方案

按探索报告（3 份 scout 报告，2026-09-08）把八条缺陷分四个批次：

1. **e2e 工具修正 + D-15 诊断先行**：探索发现 D-15 的最大嫌疑是回归脚本 `lib.mjs` 的 `sendMessage` 双发结构（disabled 分支 force click 发一次 → append 推送清批注 store → 再 fill+press 发第二次，第二条天然无批注）——静态代码证据不支持「fill/onChange 清 store」的原假设。必须先修脚本、加诊断复跑，把 D-15 定性为「脚本误报（假设 A）」或「产品竞态（假设 B：`runAgent` 内 `await ipcPromptAgentMeta` 异步间隙中 append 推送迟到清空 store）」，再决定产品侧是否动代码。
2. **PreviewPane 三条小修**（D-1/D-7/D-8）：同一文件 `PreviewPane.tsx`，删一行 + 空占位 + 文案区分。
3. **设置域三条小修**（D-4/D-11）：`SettingsViews.tsx` 两处 input 补 `type="text"`；`shell.css` 给 `.text-prompt-modal__input` 补蓝色 `:focus` 规则（四个弹窗统一受益）。
4. **两个结构性 UI 修复**（D-9/D-12）：抽屉 open/sessionId 变化时重置子面板 state + 技能面板补返回入口；SettingsOverlay 统一导航守卫（dirty 先问后切）+ SkillDetailView dirty 上报。

全部改动都在 `apps/desktop/renderer/`（含一处 `scripts/e2e/lib.mjs`），不动 main 进程、不动 core schema、无 SCHEMA_BOOT_VERSION 变更。

## 最终项目结构

改动文件（全部位于 `.worktree/desktop-regression-fixes/`）：

```
apps/desktop/renderer/layout/PreviewPane.tsx          # D-1 删行、D-7 空占位、D-8 文案
apps/desktop/renderer/features/settings/SettingsViews.tsx  # D-4 两处 input type
apps/desktop/renderer/styles/shell.css                # D-11 :focus 规则
apps/desktop/renderer/features/chat/ChatComposer.tsx          # Step 4 批注防御日志
apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx  # D-9 重置 effect
apps/desktop/renderer/features/chat/SessionSkillPanel.tsx    # D-9 返回按钮
apps/desktop/renderer/features/settings/SkillDetailView.tsx  # D-12 dirty 上报 + guarded 条件修正
apps/desktop/renderer/layout/SettingsOverlay.tsx      # D-12 导航守卫
apps/desktop/renderer/features/settings/settings-nav.ts  # D-12 dirty 通道类型（视方案）
scripts/e2e/lib.mjs                                    # sendMessage 双发修正（先行）
scripts/e2e/case-annotate2.mjs                         # D-15 诊断断言增强
```

## 变更点清单

### D-15（诊断定性 → 条件修复）

**已知事实链**（scout 报告一）：批注草稿存 renderer 进程内 `Map<sessionId, Draft[]>`（`packages/core/src/domain/chat/logic/chat-annotate-draft-store.ts`，renderer 与 main 各持独立实例）；发送时 `ChatComposer.tsx` `runAgent` 读 `listChatAnnotateDrafts(sessionId)` 随 `ipcAgentRun` 传值给 main 无条件落库；**清空常规路径有两条**：①「任何一次 user 消息 append 成功」的异步广播回调（`ChatComposer.tsx:153-168`，无发送关联校验）；②`rollback-annotate-restore.ts:48-50`——Undo/rewind 且锚点为 assistant 时 `clearChatAnnotateDrafts(sessionId)` 清空该会话全部草稿（renderer 侧直清，与发送链路无关）。fill→onChange→草稿保存是纯 repo 写，**不碰 store**。

- **假设 A（脚本误报）**：`lib.mjs` `sendMessage`（L129-148）的 disabled 半段 force click 先发一条（批注正常随它落库）→ append 推送清 store → fill+Control+Enter 第二条纯文本。R3 对照实验（disabled+force click→附件正常）与 R7 实验（fill 后丢失）恰好各对应一个半段，「fill 触发 onChange」是误归因。
- **假设 B（产品竞态）**：`runAgent` 内 `await ipcPromptAgentMeta`（L348）在读 store（L365）之前——前一轮 run 的 append 推送若在此间隙迟到，本轮读空。
- 两假设共享同一结构性观察：读 store 与清 store 间无关联保护。

**处置**：
- 先修 `lib.mjs` sendMessage（disabled 分支发送后**直接 return**，不再落第二次发送；正常分支保持 fill+press 单发），重跑 `case-annotate2` 看落库消息是否带批注附件。
- 若带（假设 A 成立）：D-15 改判「脚本误报」→ PRD 登记「已排除」，产品不动代码；同时按探索挂点 d 在 `runAgent` 读 store 处加一条防御性 bridge log（`hasChatAnnotateDrafts` 为 true 但读空时留痕，便于真机诊断）——可选，默认做（零风险三行）。
- 若仍丢（假设 B 成立）：实施挂点 a——`runAgent` 内把 `listChatAnnotateDrafts(sessionId)` 读取提到 `ipcPromptAgentMeta` await 之前（或 send() 同步读好作参数传入），消除异步间隙；挂点 b（清 store 语义与 append 推送解耦，按发送快照清）影响 rollback/移动端对齐语义，**不实施**，记入 PRD 待后续拍板。
- 若挂点 a 实施后复跑仍丢（**两者皆否**）：停止产品侧继续改动，回 PRD 重新定性——排查方向至少含：已知事实链路径②（rollback/rewind 清 store 与复跑脚本的时序交叠）、store 写入面（chip 显示但 store 未写入或提前被清）、以及 main/renderer 双实例的 store 隔离假设本身。

### D-1 PreviewPane 空态 ReferenceError

删 `PreviewPane.tsx:139` 的 `setVersion(undefined);` 一行。**不得**补回 version state（v1.5.12 已整体拆除 VFS 版本门，恢复与既定方向相反）。删行后 L140 `setFileMissing(false)` 自然恢复执行。

### D-7 空文件预览无占位

`PreviewPane.tsx` L409-417 read 模式渲染：markdown 分支对空 `content` 加占位（与 pre 分支「（空文件）」同文案口径），实现上在 `isMarkdown` 分支内 `content` 为空时渲染 `<p className="preview-empty">（空文件）</p>`（或等价短路）。`shouldRenderMarkdownPreview` 按 `.md` 后缀无条件 true 的行为不动。

### D-8 空态文案未按模式区分

`PreviewPane.tsx` L394-398：`!previewFile` 分支文案按 `mode` 区分——read 态「在工作区选择文件以预览」、edit 态「在工作区选择文件以编辑」。注意：mode 会随 previewFile 清空被重置回 read（loadFile 引用变化触发），文案区分只覆盖「清空后用户手动切到编辑」的路径，验收按此路径写。

### D-4 ProviderFormView input 缺 type

`SettingsViews.tsx` L1117（Base URL）、L1120（服务商名称）两处 input 补 `type="text"`（参照 `AgentEditorView.tsx:678-681`）。**范围仅此两处**（PRD 点名）；S3 表单、测试文本框等同类欠账不在本批（探索报告风险 4），登记回 PRD 作后续一致性清理项。

### D-11 技能弹窗聚焦描边橙色

`shell.css` L5515 段 `.text-prompt-modal__input`（及同段 `__textarea`）补 `:focus` 规则，复用全局蓝色范式（L2528 `border-color: var(--primary-ring); box-shadow: 0 0 0 3px var(--primary-glow); outline: none;`）。**外溢说明**：该 class 被 TextPromptModal / NewSkillModal / AddModelModal / DirectoryRuleModal 四个弹窗共用，补规则后全部统一变蓝——正向收益，符合「统一为蓝色」意图，不单独特判。橙色根因（Chromium 默认 focus ring 取 Linux 系统高亮色）为排除法推断，不阻塞修复（显式规则即收敛解）。

### D-9 抽屉子面板状态残留 + 技能面板无返回

两层修复（探索报告二）：

1. `SessionDetailDrawer.tsx` 新增 effect，依赖 `[open, sessionId]`：open 变 true 或 sessionId 变化时 `setSearchPanelOpen(false); setSkillsPanelOpen(false);`（组件 `if (!open) return null` 不卸载，state 跨开关、跨会话残留是根因）。
2. `SessionSkillPanel.tsx` 头部左侧补「‹返回」按钮：`onClick={onClose}`，形态参照 `ChatHistorySearchPanel` 的 `chat-history-search__back`（shell.css L6652-6669 可参照），`data-session-detail-action="skill-panel-back"` + aria-label「返回会话详情」（保持 e2e 命名惯例）。

### D-12 SkillDetailView dirty 拦截泄漏

机制设计（探索报告二）：**拦截必须在导航分发动作执行之前**（React 卸载时无法可靠弹确认框，`<div key={viewId}>` 使 viewId 变化即同步卸载）。

1. **dirty 上报通道**：`SkillDetailView` 通过 `nav`（`SettingsNavHandle`）上报——`navState` 是 mutable ref 且有直接写先例（`SkillsManageView.tsx:121` 写 `viewingSkillRef`）。扩展方案：`SettingsNavState` 加 `skillDetailDirty?: boolean` 字段（或通用 `dirtyViews: Set<string>`，见待拍板①），SkillDetailView 在 `useEffect [isDirty]` 里写 `nav.navState.skillDetailDirty = isDirty`。
2. **守卫分发**：`SettingsOverlay.tsx` 四个泄漏分发点统一过守卫——`navigateTopLevel`（侧导航按钮）、`popView`（header「‹返回上一级」）、`handleClose`（× 关闭）、`OPEN_SETTINGS_VIEW_EVENT` 事件处理器（编程式跳转，见第 3 条）。守卫逻辑：目标切换会卸载当前 view（或改写其 ref 入参，见第 3 条失效模式②）且该 view 上报 dirty 时，先弹 ConfirmModal（复用 SkillDetailView 现有「未保存的更改」danger 弹窗同款），确认后执行导航、取消则不动。实现采用「pending 导航 + 确认后落地」模式（与 SkillDetailView 现有 `leaveConfirm(() => action)` 同构，提升到 Overlay 层）。
3. **第四分发点：`OPEN_SETTINGS_VIEW_EVENT` 编程式跳转**（第 1 轮审查补充，结构性）：`SettingsOverlay.tsx` L109-126 的 window 事件处理器是独立于侧导航/返回/关闭的第四个导航分发点，触发源在设置页之外——聊天侧会话抽屉 `SessionSkillPanel.tsx` 的「整理」按钮（走 `navigateTopLevel("skillsManage")`，L117）与技能行点击 openDetail（先 L120 `navStateRef.current.viewingSkillRef = detail.skillRef` 覆写、再 L121-123 条件 `pushView("skillDetail")`），触发时设置页通常处于 hidden 态。若守卫只挂前三个分发点，存在两个失效模式：
   - **① hidden 态确认框不可见**：hidden 态点「整理」→ `navigateTopLevel` 被守卫拦截弹 ConfirmModal——若弹窗渲染时 overlay 仍 hidden，用户看到的是「点了没反应」。
   - **② viewingSkillRef 覆写绕过守卫**：已在 skillDetail（技能 A，dirty）→ 聊天侧点技能 B 行 → L120 在任何被守卫的导航之前就把 viewingSkillRef 覆写为 B，且 viewId 未变（L121 条件不满足、不 pushView）→ 组件不卸载、前三个分发点全不触发 → SkillDetailView 的 `useEffect [ref?.domain, ref?.projectId, ref?.name]`（L103-122）重置 selected/mode 并 reloadFiles，`loadFile` 用 B 的内容直接覆盖 state——A 的脏编辑静默丢失。

   修复规定：
   - 事件处理器内的**全部导航副作用**（`navigateTopLevel` 调用、viewingSkillRef 覆写、`pushView`）不得直接落地，统一包成 pending 动作过与其余三分发点同一套 ConfirmModal 守卫，确认后才执行；取消则 pending 作废、navState 不动。**同技能重点击放行**：incoming skillRef 与当前 viewingSkillRef 三元组（domain/projectId/name）相同时直接放行不弹窗（三元组相同不触发 reload、无数据丢失，弹窗属误报）。
   - **hidden 态可见性契约**：守卫挂起（pending 等待确认）期间设置页必须处于 open 可见态。当前 `App.tsx` L80-89 监听同名事件、`detail != null` 即 `setSettingsOpen(true)`，与 Overlay 侧 handler 在同一 window 事件内同步执行、同批渲染，天然满足「确认框出现即 overlay 已打开」——spec 将此定为显式契约：不得移除或绕开 App 侧监听的打开语义，守卫实现不得存在「hidden 时静默挂起」分支；T-G4 以「弹窗可见」断言保护该契约。
   - **实现注（navState 换对象陷阱）**：`handleClose` 里 `navStateRef.current = {}`（L170）整体换成新对象，而 nav memo（L95-102）的 deps 是 `[pushView, popView]`——pushView 实际依赖 `[viewId]`（L77-80），viewId 变化会使 memo 重算、`nav.navState` 刷新到新 ref，多数导航路径自愈；**持续分叉只发生在 handleClose 换对象时 viewId 不变的顶层页**（如停在 workspace 直接点 ×）——此窗口内 SkillDetailView 经 `nav.navState` 写 dirty、守卫经 `navStateRef.current` 读，通道断裂且不会自愈。实现须规避：dirty 读写统一走同一引用，或 handleClose 换对象时同步使 nav memo 失效（把 navState 引用纳入 memo 依赖或 getter 化）。Step 8 落地时以此为准。
4. **guarded 条件修正**：SkillDetailView 现有 `guarded` 的 `isDirty && mode === "edit"` 中 `mode === "edit"` 是多余且有害的（编辑后切「查看」模式 content 不清、dirty 仍在，此时点其它文件 guard 不触发，`useEffect [selected]` 的 `loadFile` 直接覆盖 content）——去掉该条件，`isDirty` 单独判定。
5. **AppChrome toggle 路径不拦**（显式决策）：App.tsx L343 的 toggle 只 hidden 不重置 viewId/pageStack，dirty 保留、重开还在原页——无数据丢失，不需要守卫。此差异写入交付说明。注意与第 3 条的边界：不拦的是「hidden→open 原页重现」（无导航分发、无数据丢失）；dirty 跨 hidden 期存活期间，从 hidden 态触达的任何导航切换（侧导航、编程式跳转）都必须受守卫——失效模式②的前置状态正是「toggle 关闭后 dirty 存活」。

**待拍板①（粒度）**：守卫机制做成通用（`dirtyViews` 集合，日后 ProviderFormView/AgentEditorView 等编辑页可复用上报）vs 只对 skillDetail 特判。**推荐通用集合**——成本相近，且「拆功能漏网」在这个代码库已是第二次；PRD 确认后按通用实现。

## 详细实现步骤

- Step 1 — phase-e2e-tooling — blocking: yes — qa: auto：修 `scripts/e2e/lib.mjs`：①E2E_DIR/DESKTOP 改为基于脚本自身位置动态解析（`import.meta.url` 向上定位，消除旧 worktree 绝对路径硬编码，保证 e2e 资产在新 worktree 可跑）；②sendMessage 双发结构（disabled 分支 force click 后**先观察到发送按钮 label 离开「发送」再等它回归**再 return——两段均有界：离开段 5s 上限（`runAgent` 首句 `await ipcPromptAgentMeta`（ChatComposer.tsx L348）先于 `beginUiRun()`（L359-360），force click 瞬间 label 仍为「发送」，若轮询首查即判「回归」会零等待假收敛）、回归段 15s 上限（slow mock 分段流式（lib.mjs L29-35，分段间隔 300ms）一轮续跑可达 ~12s，固定 4s 等待会与后续步骤竞态）；enabled 分支 fill+press 单发）。`case-annotate2.mjs` 发送后断言最近一条 user 消息的附件（evaluate 读消息 DOM 或查库）——断言须为**带超时的重试式读取**：先确认「最近一条 user 消息」确为本次发送落库的那条（如消息文本匹配发送内容）再验附件，避免读到发送前的旧消息。
- Step 2 — phase-annotate-diag — blocking: yes — qa: auto：清库 bootstrap → 跑 case-annotate2 诊断版，检查批注附件是否随消息落库；结论写入 PRD（假设 A → D-15 改判已排除；假设 B → 进入 Step 3；复跑结果与两假设预期均不符——如 disabled 单发路径也不带附件——同样进 Step 3，并在 PRD 登记异常证据供「两者皆否」出口引用）。**【已执行·2026-09-08 结论：假设 A 成立】**enabled 半段单发后附件 DOM+查库双铁证（seq=5 attachments_json 含完整 annotate 附件）；PRD 已改判 D-15 已排除，Step 3 不执行，Step 4 照做。
- Step 3 — phase-annotate-fix — blocking: yes — qa: auto：（假设 A 被排除时——假设 B 成立，或 Step 2 的两者皆否分支同样先试此修）`ChatComposer.tsx` `runAgent` 内 `listChatAnnotateDrafts` 读取提到 `ipcPromptAgentMeta` await 之前；复跑 case-annotate2 验证附件落库 + 下划线投影重验（打开文件看 `[data-annotator-id]`/下划线元素）；**复跑仍丢 → 两者皆否**：停止产品侧继续改动，回 PRD 重新定性（排查方向见变更点清单 D-15 处置段「两者皆否」条，含 rollback 清 store 路径与 store 写入面）。**【不执行·Step 2 结论假设 A】**
- Step 4 — phase-annotate-guard — blocking: no — qa: auto：（两种假设下都做）`runAgent` 读 store 处加防御 bridge log：发送意图含批注 chip 但 `listChatAnnotateDrafts` 读空时 console 留痕（钉死 renderer `console.error`——launchApp 的 errors 收集只收 `type === "error"` 的 console 消息（lib.mjs L75，过滤名单仅 Electron Security Warning / Insecure Content 两类），用 `console.warn` 在 e2e 收集里不可见；三行内）。
- Step 5 — phase-preview-panes — blocking: yes — qa: auto：PreviewPane.tsx 三处修改（删 L139 setVersion 行；markdown 空内容占位「（空文件）」；空态文案按 mode 区分「以预览/以编辑」）。
- Step 6 — phase-settings-form — blocking: yes — qa: auto：SettingsViews.tsx L1117/L1120 补 `type="text"`；shell.css `.text-prompt-modal__input/__textarea` 补蓝色 `:focus`。
- Step 7 — phase-drawer-reset — blocking: yes — qa: auto：SessionDetailDrawer 加 `[open, sessionId]` 重置 effect；SessionSkillPanel 头部补返回按钮（含 `data-session-detail-action="skill-panel-back"`、aria-label、样式参照 chat-history-search__back）。
- Step 8 — phase-nav-guard — blocking: yes — qa: auto：settings-nav.ts 扩展 dirty 通道（通用 `dirtyViews` 集合，待拍板①确认粒度；SkillDetailView 挂载时 effect 首跑即写当前 isDirty 值——通用集合下被确认导航卸载的 view 残留脏标记靠此自愈）；SkillDetailView 上报 isDirty + 去掉 guarded 的 `mode === "edit"` 条件；SettingsOverlay 四分发点（navigateTopLevel/popView/handleClose + `OPEN_SETTINGS_VIEW_EVENT` 处理器）接 ConfirmModal 守卫（pending 导航模式；事件处理器内 viewingSkillRef 覆写一并包入 pending 动作、确认后才落地；同 skillRef 三元组重复进入直接放行；hidden 态可见性契约与 navState 换对象陷阱见变更点清单 D-12 第 3 条）。
- Step 9 — phase-regression — blocking: yes — qa: auto：全量复验（前置：e2e 加固——launchApp 后版本弹窗「今日已是最新」兜底关闭（snooze 存库随清库失效，首轮必弹）；工作区右键建文件坐标动态化（取 `.workspace-trees` boundingBox 中心，替代固定 640,300）——两刀皆为 verify 阶段实踩的坑）——清库 bootstrap + case-annotate2 / case-session-mgmt / case-models-skills / case-s3-update / case-subagent / case-zip-backup 逐个跑通；新增断言：①e2e 全程 errors 收集数组中不再出现 `setVersion`；②显式关闭最后一个预览 tab 后 errors 数组不含 `setVersion` 相关错误（D-1 触发路径回归；不断言「为空」——过滤名单外的无关 console 噪声会进 errors，为空断言易误报）；③D-9/修复后打开抽屉→技能面板→关闭重开→应回默认视图（case 断言）；④D-12 脏编辑→侧导航切换→确认弹窗出现、取消留在原页、确认后切走。
- Step 10 — phase-qualify-pending — blocking: no — qa: manual_user：待定性条目顺带定性——D-5/D-6（复验时截图对比发送按钮空态色与助手气泡边框，核对 composer-send-intent 渲染语义后登记定性）；D-13（Agent YAML 导出补验，选择器避开「导入 YAML」撞名）；D-14（检查更新人工复核）。
- Step 11 — phase-merge-dev — blocking: yes — qa: auto：`NODE_ENV=development npm test`（apps/desktop）全绿 + `npm run build`（renderer+main）通过后，worktree 提交并入 dev 分支（项目规则 #37；提交信息按规则 #15 带根因与修复机制）。

## 测试策略

### 测试用例

- T-A1 — blocking: yes — mapping Step 1/2：sendMessage 单发修正后，划词→添加→输入文本→发送，消息附件含批注卡片（查 DOM「消息附件」或查库 attachments；重试式读取——先确认最近一条 user 消息文本匹配本次发送内容再验附件）。
- T-A2 — blocking: yes — mapping Step 3/5：批注发送后重开文件，下划线投影出现（`[data-annotator-id]` 或下划线元素命中）——D-15 修复（或撤销）后补做 PRD 欠的下划线投影验证。
- T-P1 — blocking: yes — mapping Step 5：e2e 全程 console 无 `setVersion is not defined`；显式关 tab 后 errors 数组不含 `setVersion` 相关错误。
- T-P2 — blocking: yes — mapping Step 5：新建空 .md 文件→预览显示「（空文件）」占位（截图断言）。
- T-P3 — blocking: yes — mapping Step 5：清空预览后手动切「编辑」→空态文案为「在工作区选择文件以编辑」。
- T-S1 — blocking: yes — mapping Step 6：`input[type="text"]` 选择器可稳定命中 Base URL 与服务商名称两输入框（e2e 定位改用回此选择器断言）。
- T-S2 — blocking: yes — mapping Step 6：四个共用弹窗（TextPrompt/NewSkill/AddModel/DirectoryRule）输入框聚焦描边为蓝色（截图 + token 值断言 `--primary-ring`）。
- T-D1 — blocking: yes — mapping Step 7：抽屉→技能面板→关闭抽屉→重开→默认视图（断言 skillsPanel 容器不在 DOM）；切会话后重开同理。
- T-D2 — blocking: yes — mapping Step 7：技能面板「‹返回」点击回默认视图（`data-session-detail-action="skill-panel-back"` 可定位）。
- T-G1 — blocking: yes — mapping Step 8：SKILL.md 脏编辑→点侧导航切走→「未保存的更改」确认弹窗出现；取消→留在原页内容不丢；确认→切走。
- T-G2 — blocking: yes — mapping Step 8：header「‹返回上一级」与「× 关闭设置」同受守卫（T-G1 同法验证两条路径）。
- T-G3 — blocking: yes — mapping Step 8：编辑后切「查看」模式→点其它文件→守卫仍触发（guarded 条件修正回归）。
- T-G4 — blocking: yes — mapping Step 8：skillDetail 技能 A 脏编辑→关闭设置页（toggle，dirty 存活）→聊天侧会话抽屉技能面板点技能 B 行→设置页打开且「未保存的更改」确认弹窗可见（hidden 态可见性契约断言）；取消→留在技能 A、编辑内容不丢；确认→切到技能 B。同法验证「整理」按钮路径（hidden 态→skillsManage pending→弹窗可见）。
- T-R1 — blocking: yes — mapping Step 9：scripts/e2e 六个 case 脚本 + bootstrap 全部跑通，首轮回归既有通过项（滚动/创建链/设置页/主题）保持通过。
- T-Q1 — blocking: no — mapping Step 10：D-5/D-6/D-13 定性结论登记回 PRD（qa: manual_user 部分为用户复核）。

### 单元/集成测试

`apps/desktop/test/` 已有 `chat-composer.integration.test.ts`、`chat-annotate-draft.test.ts`——Step 3 若实施，补「runAgent 读取时机」回归用例；Step 8 的守卫逻辑若可抽纯函数（「目标会卸载当前 view 或改写其 ref 入参、且 dirty → 拦截；改写 ref 入参时新旧三元组等价则放行」判定，涵盖第四分发点不卸载但覆写 viewingSkillRef 的情形）补桌面单测。跑法统一 `NODE_ENV=development npm test`（apps/desktop）。

## 风险与回滚方案

| 风险 | 缓解 |
|---|---|
| D-15 定性为假设 A 后 PRD 结论反转 | Step 2 强制先行、结论写回 PRD；产品代码不动即零回滚成本 |
| Step 3 读取前移改变 runAgent 时序 | 读取是纯同步 Map 查询，前移无副作用；case-annotate2 + 既有单测回归 |
| D-12 守卫把正常导航变慢/卡死 | ConfirmModal 仅在 dirty 时出现；取消路径原样不动；pending 导航失败兜底=不切换（保守侧） |
| D-12 第四分发点 pending 化改变事件处理时序 | 事件处理器只挂 pending 不直接落地；App 侧同名监听 setSettingsOpen(true) 与守卫弹窗同事件同批渲染，hidden 态不静默；T-G4 覆盖聊天侧两条入口 |
| dirty 上报 via mutable ref 的时序（effect 未跑就导航） | isDirty 变化即同步写 ref（useEffect 依赖 isDirty，React 提交后立即跑）；导航分发读 ref 时最多落后一帧，用户可感知的输入丢失窗口为零（打字中的每次 onChange 都会触发 effect 重写） |
| D-11 四弹窗统一变蓝的外溢 | 正向收益，交付说明写明；如需回退删一条 CSS 规则即回 |
| e2e 环境依赖（X 显示/keyring） | 复验前检查 keyring 状态（coverage.md 备忘流程）；keyring 失效只影响发消息类用例，UI 类用例不受阻 |

回滚方案：全部改动集中在 renderer + 一个 e2e 脚本，git 单分支（desk-e2e-test）逐 Step 提交，任一 Step 失败 `git revert` 对应提交即可，无数据迁移、无 schema 变更。
