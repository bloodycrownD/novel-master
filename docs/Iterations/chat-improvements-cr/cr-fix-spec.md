# CR Fix Spec: chat-improvements 集成 CR 修复说明书

## 元信息
- repo: novel-master
- base_sha: 515da9d
- head_sha: dc16a99（即当前 HEAD）
- 分支: feat/chat-improvements-integration（515da9d..dc16a99，共 30 commit）
- review_round: 1
- 状态: draft
- 来源: chat-improvements CR scope review（core / desktop / mobile-web / mobile-rn 四切片交叉复核）
- 模板对齐: docs/Iterations/cr-fix-spec/review/phase5-fix-spec/D5-1-fix-spec.md（code-review-loop「fix-spec 文档结构」）

> 本 round 无 P0（无数据丢失 / 安全级发现）。修复顺序：P1 3 条（行为口径 / 体验回退 / 竞态）→ P2 按 core → mobile-web → mobile-rn → desktop 收尾。desktop/G-1 随 desktop/A-1 定案，不单独排期。

---

## Must-fix

### P1

#### core/B-1 [P1] write run 无条件补父链规则——编辑已有文件也把存量无行目录静默翻 rule_on
- 严重度: P1（行为超出用户原话口径，静默修改存量状态）
- 维度: 行为口径（B）
- 文件:
  - `packages/core/src/domain/tool/builtin/vfs-tools.ts`（write 的 run 内 `await ensureDirRulesForNewPath(ctx, parentDirOfLogicalPath(logicalPath))`，约 L254-258；`ensureDirRulesForNewPath` 定义约 L569 起；fs mkdir 路径约 L376-378 同样调用）
- 问题: write 成功后无条件对父链逐层补 `dir_rule`，编辑已有文件也会触发。这超出了用户原话「write 工具创建文件/文件夹时默认启用」的口径——存量无行目录会被静默翻成 rule_on，用户感知不到且无法预期。mkdir（新建语义明确）不受本条影响，维持现状。
- 改法:
  1. write 前探测目标文件是否已存在（`ctx vfs.read` 或 stat，以现有工具上下文可用的探测原语为准）。
  2. 已存在 → 跳过补规则，走纯编辑路径；不存在（新建）→ 维持现状，对父链各层补规则。
  3. 探测本身失败时保守处理：视作「已存在」跳过补规则（宁可少补、不可误翻存量），并留一行 debug trace。
- 验收/测试:
  - 新增测试（`packages/core/test/tool/vfs-tools.test.ts`）：预置一个祖先目录均无 dir_rule 行的已有文件 → write 编辑它 → 断言所有祖先目录仍无规则行。
  - 新增测试：同一路径下新建文件 → 断言父链各层规则均为 rule_on（现有行为回归保护）。
- 依赖: 无。core/B-2 在同文件同函数族，建议同批次改。
- 来源: 本轮 CR core 切片 B-1。

#### desktop/A-1 [P1] CollapsibleMessageBody 把富文本消息压进 line-clamp:4——spec 风险节回退条款未落地
- 严重度: P1（spec 明示的回退条款未实现，渲染不可预期 + 拦截交互）
- 维度: 体验 / spec 落地（A）
- 文件:
  - `apps/desktop/renderer/features/chat/MessageList.tsx`（`CollapsibleMessageBody` 约 L61 起，`isCollapsibleText` 静态规则：>200 字符或含换行；MessageList 约 L166-173 传入 `richText={chatRichText}`、`alwaysRichText={msg.role === 'assistant'}`）
- 问题: markdown 富文本天然多行，几乎必命中 `isCollapsibleText` 进 `line-clamp:4` 折叠。SVG / 表格 / 嵌套块的截断高度不可预期（clamp 按行数截，块级元素截出来的形态无法保证）；且折叠态容器的 onClick 拦截了链接点击。spec 风险节写了「富文本回退不折叠」条款，但代码没有落地。
- 改法:
  1. `richText || alwaysRichText` 为真时直接渲染 `MessageBody`，不进 clamp wrapper（回退条款落地）。
  2. 纯文本消息维持现有折叠行为不变。
  3. 按 spec 风险节原要求在 `CollapsibleMessageBody` 处写实现注，记录回退决策依据（富文本含块级元素，clamp 截断不可预期）。
- 验收/测试:
  - `apps/desktop/test/chat-search-collapsible-form.test.tsx` 补用例（见 desktop/G-1）：富文本消息渲染结果不含 clamp wrapper 结构；纯文本消息折叠行为回归不变。
  - 手动验收：富文本消息里的链接可点击、表格/SVG 完整展示（并入合并后 QA 的视觉把关）。
- 依赖: desktop/G-1（测试）随本条定案。
- 来源: 本轮 CR desktop 切片 A-1。

#### desktop/C-orch-1 [P1] ChatHistorySearchPanel runQuery 与 load-more 竞态——旧 append 晚到拼接错乱
- 严重度: P1（并发下结果串台，用户可见）
- 维度: 并发编排
- 文件:
  - `apps/desktop/renderer/features/chat/ChatHistorySearchPanel.tsx`（load-more 按钮约 L254-264 处 `disabled={loadingMore}`；查询按钮仅 `disabled={loading}`；`runQuery` 无请求序号守卫）
- 问题: load-more 进行中（`loadingMore` 为真）时查询按钮并不禁用（只看 `loading`），用户可立刻发起新查询。旧 append 响应晚于新查询响应到达时，会把旧页数据拼进新查询结果，列表内容错乱。
- 改法:
  1. 两个按钮互斥：查询按钮与 load-more 按钮均 `disabled={loading || loadingMore}`。
  2. 用 `useRef` 维护请求序号（自增 token）：发请求前 `++seq`，响应落地前校验 `seq` 是否仍为最新，不是则丢弃。双保险——按钮互斥挡住绝大多数场景，序号守卫兜住已发出的在途请求。
- 验收/测试:
  - 新增/修改测试：模拟 load-more（append）进行中发起新查询，控制旧响应晚到 → 断言旧响应不落地、列表只含新查询结果。
- 依赖: 无。
- 来源: 本轮 CR desktop 切片 C-orch-1。

### P2

#### core/C-orch-1 [P2] create-user-vfs-turn-service resolveToolCtx 未注入 workplace——用户链路与 agent 链路行为不一致
- 严重度: P2（一致性缺口，用户 user_ops 链路功能可用但行为分叉）
- 维度: 并发编排 / 链路一致性（C-orch）
- 文件:
  - `packages/core/src/service/chat/create-user-vfs-turn-service.ts`（`resolveToolCtx` 约 L58 起；对照 agent 链路的注入方式）
- 问题: 用户 user_ops 链路同样会调用 write/fs 工具，但 `resolveToolCtx` 没有像 agent 链路那样注入 workplace，导致同一条工具在这两条链路里拿到的上下文不一致（补规则等依赖 workplace 的行为只在 agent 链路生效）。
- 改法: 与 agent 链路同款注入 workplace（session scope），保持两条链路对同一工具的上下文构造一致。
- 验收/测试: 复用 core/B-1 的验收测试覆盖用户链路（或补一条：走 create-user-vfs-turn-service 的 write 调用，断言补规则行为与 agent 链路一致）。
- 依赖: 建议在 core/B-1 定案后实施，避免两遍改同一路径。
- 来源: 本轮 CR core 切片 C-orch-1。

#### core/G-1 [P2] vfs-tools 补「补规则失败不阻断」测试
- 严重度: P2（测试守卫缺口）
- 维度: 测试守卫（G）
- 文件:
  - `packages/core/test/tool/vfs-tools.test.ts`
- 问题: `ensureDirRulesForNewPath` 的 try/catch 吞错设计意图是「补规则失败不阻断 write/mkdir 主流程」，但没有测试锁定这一契约，后续重构可能把吞错改成抛错（或反之）而无测试报警。
- 改法: 补用例：mock `setDirRule`/`getDirRule` 抛错 → 断言 write 与 mkdir 仍成功返回、文件/目录已落盘。
- 验收/测试: 新增用例本身即为交付物；`packages/core` 测试套件全绿。
- 依赖: 无（若与 core/B-2 同批改，注意 mock 目标函数名同步）。
- 来源: 本轮 CR core 切片 G-1。

#### core/B-2 [P2] ensureDirRulesForNewPath 逐层 getDirRule 改批量 listDirRules；catch 留 debug trace
- 严重度: P2（性能 + 可观测性）
- 维度: 行为口径 / 性能（B）
- 文件:
  - `packages/core/src/domain/tool/builtin/vfs-tools.ts`（`ensureDirRulesForNewPath` 约 L569 起，逐层 `getDirRule` 查无行才 `setDirRule`；`ctx` 的 Pick 类型定义处同步扩展）
- 问题: 深路径逐层 `getDirRule` 是 N 次查询；整体 try/catch 吞错后一行日志都没有，出问题时无从排查。
- 改法:
  0. 前置：`WorkplaceService` 接口与实现透传 `listDirRules(scopeKey)`（service 层现仅暴露 `setDirRule`/`getDirRule`；repo 层 `workplace.port.ts` 已有 `listDirRules`）。
  1. 一次 `listDirRules` 拉全量，在内存里对父链求差集，只对缺失层 `setDirRule`。
  2. `ctx` 的 Pick 类型扩含 `listDirRules`。
  3. catch 分支至少留一行 debug trace（含失败路径与错误信息）。
- 验收/测试: core/B-1 的两条验收测试回归通过（行为不变）；可顺手断言补规则调用次数从逐层 N 次降为差集次数。
- 依赖: 与 core/B-1 同文件同函数族，建议同批次。
- 来源: 本轮 CR core 切片 B-2。

#### mobile-web/G-1 [P2] build-webview.mjs injectCss 的 replace 字符串形式有 `$` 展开风险
- 严重度: P2（潜伏 bug，CSS 含 `$&` 等序列时炸）
- 维度: 构建守卫（G）
- 文件:
  - `apps/mobile/scripts/build-webview.mjs`（`injectCss` 约 L84-89，`shellCss.replace('/* __RICH_CSS__ */', richCss)`）
- 问题: `String.prototype.replace` 第二参为字符串时，替换串里的 `$$`/`$&`/`$'` 等会被特殊展开。CSS 内容（如某些 minified 库产物）一旦含这些序列，注入结果被静默破坏。
- 改法: 改函数形式 `replace(placeholder, () => css)`，彻底绕开 `$` 展开。
- 验收/测试: 构建一次 webview 产物，抽查注入后的 CSS 完整（可加一个含 `$&` 的 smoke 用例或人工核对 diff）。
- 依赖: 无。
- 来源: 本轮 CR mobile-web 切片 G-1。

#### mobile-web/A-1 [P2] rich-document main.ts setDocument 连续刷新时 Recogito 按中间态初始化
- 严重度: P2（连续操作下标注层状态错乱）
- 维度: 体验 / 异步时序（A）
- 文件:
  - `apps/mobile/src/web/rich-document/webview/main.ts`（`setDocument` → `refreshAnnotateAfterDocument`；对照 `__tests__/annotate-recogito-preview.test.ts` 约 L153-163 的测试契约）
- 问题: 文档连续刷新（快速翻页/重开）时，前一次 `setDocument` 的异步链未完成即被新一轮覆盖，`refreshAnnotateAfterDocument` 可能按中间态文档给 Recogito 建标注层。
- 改法: `setDocument` 入口自增 token（`useRef`/模块级计数均可，按 webview 侧现有风格）；异步链 `finally` 里校验 token 仍是最新才执行 `refreshAnnotateAfterDocument`，否则放弃。
- 验收/测试: 复用/扩展 `annotate-recogito-preview.test.ts`：模拟连续两次 setDocument，断言 Recogito 只按最终文档态初始化一次。
- 依赖: 无。注意不要破坏该测试文件既有的 L153-163 契约。
- 来源: 本轮 CR mobile-web 切片 A-1。

#### mobile-web/A-2 [P2] mermaid-fullscreen 事件委托无幂等守卫 + 开门前不校验 _renderView
- 严重度: P2（重复 attach 监听器泄漏 / 空渲染器开门白屏）
- 维度: 体验 / 防御（A）
- 文件:
  - `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-fullscreen.ts`（`openMermaidViewer` 约 L47 起，已有 `_open` 守卫但不校验 `_renderView`；`attachMermaidViewerDelegation` 约 L85 起无幂等守卫；rich-document 与 chat-transcript 两处 main.ts 均调用）
- 问题: `attachMermaidViewerDelegation` 重复调用会叠加监听器；`openMermaidViewer` 在 `_renderView` 未注册时照样开门，用户看到空的全屏容器。
- 改法:
  1. `attachMermaidViewerDelegation` 加幂等守卫（已 attach 则跳过）。
  2. `openMermaidViewer` 开门前成对校验 `_renderView && _post` 均已就绪，否则直接 return（只校验 _renderView 仍可能在 post 缺失时开门后无法通知 RN 关闭）。
- 验收/测试: 单测或手动：连续两次 attach 断言监听器只挂一次；未注册 renderView 时调 open 断言全屏层不出现。
- 依赖: 无。
- 来源: 本轮 CR mobile-web 切片 A-2。

#### mobile-web/C-1 [P2] 修 annotate.ts 存量泛型错 + webview 代码纳入 typecheck 门禁
- 严重度: P2（类型门禁缺口，存量错误一直无人看见）
- 维度: 类型门禁（C）
- 文件:
  - `apps/mobile/src/web/rich-document/webview/runtime/annotate.ts`（存量 TextAnnotator 泛型错）
  - `apps/mobile/package.json`（typecheck 脚本）
- 问题: `tsc -p src/web/tsconfig.json` 不在任何 typecheck 脚本里，webview 源码游离在类型门禁外，`annotate.ts` 的存量泛型错误（TextAnnotator 相关）长期无人看见。
- 改法:
  1. 修复 `annotate.ts` 存量 TextAnnotator 泛型错误。
  2. 把 `tsc -p src/web/tsconfig.json` 挂进 `apps/mobile` 的 typecheck 脚本（webview 代码进类型门禁）。
- 验收/测试: `apps/mobile` 下跑 typecheck 脚本，`src/web` 全量通过零报错；CI 的 typecheck job 同样覆盖到。
- 依赖: 无。注意 CI 当前 typecheck 是 `continue-on-error: true`，本条不要求动 CI 配置（见 K 节建议）。
- 来源: 本轮 CR mobile-web 切片 C-1。

#### mobile-web/C-2 [P2] rich-content-styles.ts 存在不可达选择器分支
- 严重度: P2（死代码）
- 维度: 类型门禁 / 代码卫生（C）
- 文件:
  - `apps/mobile/src/web/shared/rich-content-styles.ts`（`mermaidSourceVisible` 约 L21-24 flatMap 产出 `.mermaid-block.mermaid-failed .mermaid-block__source`）
- 问题: `.mermaid-block.mermaid-failed .mermaid-block__source` 选择器对应的状态组合不可达（failed 态下 source 不会以该结构出现），属死代码。
- 改法: 删掉该分支（flatMap 分支与相关常量一并清理）。
- 验收/测试: 产物 CSS 中不再出现该选择器；mermaid 失败/成功两态渲染回归正常（目视或既有测试）。
- 依赖: 无。
- 来源: 本轮 CR mobile-web 切片 C-2。

#### mobile-rn/A-1 [P2] RichDocumentWebView ready 分支不复位 mermaidViewerOpenRef——WebView 重建后吞返回键
- 严重度: P2（重建后返回键失效，用户被困）
- 维度: 体验（A）
- 文件:
  - `apps/mobile/src/components/vfs/RichDocumentWebView.tsx`（`mermaidViewerOpenRef` 约 L128 起；`handleMessage` 约 L218-224 只处理 opened/closed）
- 问题: mermaid 全屏打开状态下 WebView 被系统回收重建，`mermaidViewerOpenRef` 仍是 true，但 webview 侧全屏层已不存在——原生返回键被「全屏打开中」的逻辑吃掉，用户回不去。
- 改法: `handleMessage` 的 ready 分支补 `mermaidViewerOpenRef.current = false`（WebView 重建即视为全屏已关）。
- 验收/测试: 手动：打开 mermaid 全屏 → 触发 WebView 重建（切后台/低内存）→ 返回键行为恢复正常。有条件可补 mock 消息序列的单测。
- 依赖: 与 mobile-web/A-2、mobile-rn/A-2 同主题（全屏开合状态对称性），建议同批验收。
- 来源: 本轮 CR mobile-rn 切片 A-1。

#### mobile-rn/A-2 [P2] ChatTranscriptWebView ready 消息不复位全屏开合状态
- 严重度: P2（与 mobile-rn/A-1 同根因的另一端）
- 维度: 体验（A）
- 文件:
  - `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx`（`handleMessage` 约 L843-850 处理 mermaidViewerOpened/Closed 上浮）
- 问题: 同 mobile-rn/A-1：WebView 重建后上浮给外层的「全屏打开中」状态残留，外层据此做的返回键/手势处理全部失真。
- 改法: ready 消息时调 `onWebMermaidViewerOpenChange?.(false)`（对称复位）。
- 验收/测试: 手动同 mobile-rn/A-1 的场景，在会话转录页验证。
- 依赖: 与 mobile-rn/A-1 同批。
- 来源: 本轮 CR mobile-rn 切片 A-2。

#### mobile-rn/A-3 [P2] ChatHistorySearchScreen 错误文本藏在折叠卡片内——收起态翻页失败不可见
- 严重度: P2（错误反馈丢失）
- 维度: 体验（A）
- 文件:
  - `apps/mobile/src/screens/stack/ChatHistorySearchScreen.tsx`
- 问题: 翻页（加载更多）失败的错误文本渲染在可折叠的结果卡片内部，卡片收起时错误完全不可见，用户不知道翻页失败了。
- 改法: 错误文本移出折叠卡片，恒显在列表/卡片外层（布局位置以现有页面结构就近安放）。
- 验收/测试: 手动：收起结果卡片 → 制造翻页失败 → 错误提示仍可见。
- 依赖: 无。
- 来源: 本轮 CR mobile-rn 切片 A-3。

#### desktop/G-1 [P2] chat-search-collapsible-form 测试补富文本不进 clamp wrapper 用例
- 严重度: P2（测试守卫，随 desktop/A-1 定案）
- 维度: 测试守卫（G）
- 文件:
  - `apps/desktop/test/chat-search-collapsible-form.test.tsx`（沿用 T-CF6 用例风格：renderToStaticMarkup 断言）
- 问题: desktop/A-1 落地后需要测试锁定「富文本消息不进 clamp wrapper」这一回退行为，防止后续重构悄悄退化。
- 改法: 补用例：构造 `richText`（或 `alwaysRichText`）为真的消息渲染输出，断言不含 clamp wrapper 结构；同时保留纯文本折叠行为的既有断言。
- 验收/测试: 新增用例通过；desktop 测试套件全绿。
- 依赖: desktop/A-1（先定改法再写断言）。
- 来源: 本轮 CR desktop 切片 G-1。

#### desktop/C-1 [P2] MermaidMarkdown svgCache 无上限——长会话内存只增不减
- 严重度: P2（资源泄漏，慢性）
- 维度: 资源管理（C）
- 文件:
  - `apps/desktop/renderer/components/MermaidMarkdown.tsx`（模块级 `svgCache = new Map()` 无上限；另有 `FAILED_PLACEHOLDER` 与 `inflight`；`resetMermaidCacheForTests` 已存在，注意 LRU 改造后同步它；mobile 侧对应 `apps/mobile/src/web/shared/mermaid-core.ts` 的 `createMermaidSourceCache`，本条只改 desktop 侧）
- 问题: 模块级缓存永不清除，长会话里每个 mermaid 图的 SVG 都留在内存；失败占位一旦写入永不重试，临时性渲染失败（如并发初始化冲突）变成永久失败。
- 注: mobile 侧 `createMermaidSourceCache`（mermaid-core.ts）同款无上限/失败永存，**有意不在本条修**——webview JS 环境随会话切换整体重建、缓存生命周期短，风险量级与 desktop 进程级缓存不同；后续评审勿重复上报。
- 改法:
  1. `svgCache` 加 LRU 上限（建议 100~200 条，超出淘汰最旧）。
  2. 失败占位允许重试（下次渲染重走一次）或给 TTL 过期。
- 验收/测试: 单测：写入超上限条目后断言最早条目被淘汰、最新条目可命中；失败占位在重试/TTL 语义下可再次尝试渲染（`resetMermaidCacheForTests` 语义同步更新）。
- 依赖: 无。
- 来源: 本轮 CR desktop 切片 C-1。

---

## Spec deviations
- 无 open 偏差。
- 已记录的正向偏差: memo 方案升级 svgCache（相对 spec 原文是增强，不改验收口径）。
- 待补记（非偏差，是 spec 滞后）: 表单分区 / placeholder / 数字过滤三轮 UI 反馈未回填 spec——列入 Open questions 尾项，不阻塞修复。

## Open questions（不阻塞修复，随修复批次顺带确认）
1. filterSummary 单端文案格式: 现为 `#10–止` / `#起–50` 风格，另一端为 `#≥10` / `#≤50`。建议统一为后者（数学记号无歧义、排序规则一眼可读）。谁先谁后以实现时改动最小的一端为准。
2. UI 层的 mkdir/cp/mv 不经工具层、因此不补 dir_rule——是否作为已知限制接受？接受则在 spec 记一笔，不接受则另开条目（本轮不修）。
3. fs rm 删除目录后 `dir_rule` 残留行是否属本 CR 范围外？倾向范围外（清理属独立的数据卫生任务）。
4. boot-script 测试正则放宽后，dist 产物里的变量名（压缩改名）需人工确认一次断言仍有效。
5. spec 后补记: 表单分区 / placeholder / 数字过滤三轮 UI 反馈需回填 spec（文档任务，不阻塞代码修复）。

## 已豁免
- 无。（本 round 无豁免条目。）

## 合并后 QA
1. cf Step5: 双端（desktop + mobile）手动验收——对照 chat-improvements 迭代的 Step5 清单逐项过。
2. mf Step7: 真机验收（重点覆盖 WebView 重建、mermaid 全屏、翻页失败提示三条 mobile-rn 路径）。
3. desktop/A-1 富文本视觉把关: 富文本消息不折叠后的版面（表格 / SVG / 嵌套块 / 链接点击）需人工目视确认，光靠测试断言不够。

## K 节建议（经验沉淀）
1. CI typecheck 的 `continue-on-error: true` 要尽快移除——mobile-web/C-1 把 webview 纳入门禁后，如果 CI 仍然继续放行红job，门禁形同虚设。建议作为独立小任务在本 CR 合并后立刻做。
2. 「core 改动 → 双端测试」链路里，`packages/core` build 后 dist 未更新会让双端跑到旧逻辑——跑双端测试前先重 build core dist，写进迭代 checklist。
3. 同一工具（write/fs）在 agent 链路与用户链路各有一份上下文构造（本次 core/C-orch-1 的根因）——新增依赖 ctx 的行为时，两条链路的注入点要成对检查，建议在代码里收敛为单一工厂。
4. webview 侧的「全局可变状态 + 事件委托」模式（mermaid-fullscreen）在多入口复用时容易踩幂等与复位缺口——attach 幂等 + ready 复位应作为该模式的标配写法沉淀。
