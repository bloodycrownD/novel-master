# CR Fix Spec: feat/annotate-fixes 分支评审修复

## 元信息

- repo: `D:\Dev\Js\novel-master`
- base_sha: `c25f7bb8e03a400f980cbb6953e54862b371b6cb`（main）
- head_sha: `17d3eebf00d8f08463ad27b26c1257bf1e77bf16`（feat/annotate-fixes）
- prd_path: 无独立 PRD（多改动合集分支 feat/annotate-fixes；以 diff 变更点本身为需求基线）
- spec_path: 无独立 SPEC
- review_round: 2
- dag_version: 3
- must-fix 总数: 16（P0 ×1，P1 ×2，P2 ×13；本轮新增 cr-x/H-1；cr-c/B-2 文件清单扩展不算新增条目）
- 本 wave 范围: 全部 must-fix（P0 → P1 → P2，单文件改动为主，无跨条目冲突）
- 状态: draft（round 2 修订中）

> 说明：本 spec 只描述「要怎么修」，不包含实现代码。下游执行节点按本 spec 落地实现，落地后回填状态。

---

## Must-fix（按 P0 → P1 → P2）

### P0

#### cr-a/G-01 — 测试期望与实现矛盾（批注 chip 文案）

- **严重度**: P0
- **维度**: G（测试）+ B（正确性）
- **文件**:
  - `packages/core/test/chat/status-chip-label.test.ts`
  - `packages/core/src/domain/chat/logic/status-chip-label.ts`（仅参考，不强制改）
- **问题**:
  实现 `tryParseAnnotateChipText` 现在走「`userAnnotation` 优先（trim 后），回落 `originalText`」的路径（见 `status-chip-label.ts` L245–L272），但测试还在按旧逻辑期望 `批注:短原文`。具体来说，测试 L89–L101 这条 case 的 content 里同时给了 `originalText:"短原文"` 和 `userAnnotation:"说明"`，实现会返回 `"说明"`，断言却写 `"批注:短原文"`，实跑必 fail。同理 L140–L151 那条「缺 originalText」case 的 content 含 `userAnnotation:"只有说明"`，实现返回 `"只有说明"`，断言写 `"批注:/c"`，也会 fail。
  用户已确认：chip 应显示「批注:用户批注内容」，也就是 `userAnnotation` 优先是对的——错的是测试期望，不是实现。
- **改法**:
  1. 把第一条 case（L89–L101）的期望从 `批注:短原文` 改成 `批注:说明`，因为 content 里 `userAnnotation="说明"`。
  2. 调整 L140–L151 那条 case：当前它的本意是「缺 originalText 时回落路径」，但现在实现是 userAnnotation 优先，所以这条 case 的语义已经不成立。要么把它改成「userAnnotation 为空串 + 无 originalText → 回落路径」，要么直接删掉，由下面新增的回落 case 覆盖。
  3. 补两条新 case：
     - **userAnnotation 为空串**（`userAnnotation:""`）时，回落 `originalText`；
     - **userAnnotation 缺键**（JSON 里压根没有 `userAnnotation` 字段）时，回落 `originalText`。
  4. 可选：补一条 case 验证 `userAnnotation` 会先 `trim()` 再截断（比如 `userAnnotation:"  说明  "` → `批注:说明`）。实现里已经有 trim，补测试锁住行为即可。
- **验收/测试**:
  - `packages/core/test/chat/status-chip-label.test.ts` 全部通过。
  - 覆盖三条路径：userAnnotation 优先 / 空串回落 originalText / 缺键回落 originalText。
  - 跑 `node --test packages/core/test/chat/status-chip-label.test.ts`（或仓库既有测试脚本）应绿。
- **来源**: review-scope-a / round 1

---

### P1

#### cr-c/C-1 — 导入导出逻辑三处平行复制，必须收敛

- **严重度**: P1
- **维度**: C（DRY）+ C-orch（平行入口）
- **文件**: `apps/mobile/src/components/vfs/VfsFileManager.tsx`
- **问题**:
  `handleEntityAction` 里新增的 `import-zip` / `import-character-card`（L721 起）和 `export-zip` 跟既有的 `handleImportZip` / `handleImportCharacterCard` / more 菜单里的 export 几乎逐字复制，区别只是路径来源不同——entity 菜单用 `menuPath`，more 菜单用 `currentPath`。已经能闻到不一致的味道了：toast 文案一会儿 `'失败'`（L1142 prompt submit）、一会儿 `'导入失败'`（entity 菜单）、more 菜单 export 还没有 Alert 拦截。
- **改法**:
  抽两个参数化的 helper 收敛掉：
  1. `runImport(kind: 'zip' | 'character-card', targetPath: string)`：内部统一做「Alert 确认 → 调对应 service（`importVfsZip` / `importCharacterCard`）→ `reloadVfsListOnly()` → toast」。
  2. `runExport(targetPath: string)`：内部统一做「`exportingZip` 守卫 → 调 `exportVfsZip` → toast → finally 清 `exportingZip`」（这个守卫和 cr-c/B-1 一起处理，见下）。
  entity 菜单（`handleEntityAction`）传 `menuPath`，more 菜单传 `currentPath`。`handleImportZip` / `handleImportCharacterCard` 收敛后可瘦成薄封装，或直接删掉由 `runImport` 取代。
  toast 文案统一前缀（和 cr-c/C-2 一起做）。
- **验收/测试**:
  - 导入导出六条路径行为不变：entity 菜单 zip 导入、entity 菜单角色卡导入、more 菜单 zip 导入、more 菜单角色卡导入、entity 菜单 zip 导出、more 菜单 zip 导出。
  - 每条路径都经过「Alert 确认 → service 调用 → reload → toast」。
  - 代码里不再有复制粘贴残留（grep `importVfsZip` / `importCharacterCard` / `exportVfsZip` 应只在 helper 内部出现）。
- **来源**: review-scope-c / round 1

#### cr-c/REQ-1 — 导入 zip/角色卡生成的目录规则默认开启

- **严重度**: P1
- **维度**: A（需求符合性）
- **文件**: `apps/mobile/src/components/vfs/VfsFileManager.tsx`（落点在移动端 UI 层，不动 Core）
- **问题**:
  导入 zip 或角色卡后会生成新目录，但这些新目录的「目录规则」当前默认是关闭状态。用户希望默认开启。
- **round 2 追踪到的架构真相**（修正 round 1 的错误定位）:
  - 目录规则开关状态**不在 VFS entry 上**，而在独立的 `workplace_dir_rule` 表（`WorkplaceDirRule.ruleEnabled` 字段）。
  - 规则派生逻辑在 `packages/core/src/domain/workplace/logic/workplace-rule-engine.ts` L66–79：`dirRuleMap.get(dirPath)` 取不到行 → 判 `rule_off`，所以「没有规则行」本身就等于默认关闭。
  - Core 的 import service（`vfs-zip-io.service.ts` 的 `ensureEmptyDirectoryRow`、`character-card-import.service.ts`）只插 VFS 目录行，从不写 `workplace_dir_rule` 行。
  - 现状里 `create-directory` 默认开规则，是因为 `VfsFileManager.tsx` L852 创建目录后**手动调了** `workplace.setDirRule(defaultDirRuleForm(path))`（`defaultDirRuleForm` 在 `apps/mobile/src/services/workplace-operations.service.ts` L126，`ruleEnabled: true`）——这是 UI 层补丁，不是 Core 行为。
- **改法**:
  1. 落点在**移动端 UI 层**，不要动 Core service（动 Core 会牵连 CLI/desktop 全平台行为）。
  2. 在 cr-c/C-1 抽出的 `runImport(kind, targetPath)` helper 里，import 成功 + `reloadVfsListOnly()` 之后，补一段「为新出现的目录补规则行」：
     - 导入前快照当前 `targetPath` 下的目录集合（或拿 service 返回值/事件里新创建的目录列表——目前 `importVfsZip` / `importCharacterCard` 返回 `void`，需比对导入前后目录列表）。
     - 对每个新目录调 `workplace.setDirRule(defaultDirRuleForm(newDirPath))`（`defaultDirRuleForm` 已在 `apps/mobile/src/services/workplace-operations.service.ts` L126 导出，直接复用）。
  3. zip 导入和角色卡导入共用同一条 `runImport` 路径，只改一处。
  4. 已有目录不受影响：只挑「新增」目录调 `setDirRule`，不覆盖旧目录规则。
  5. 边界：如果导入的目标 `directoryPath` 本身已存在，不对它调 `setDirRule`（会覆盖用户已有规则），只对导入产物里的新子目录调。
- **验收/测试**:
  - 导入 zip 后，**新出现的子目录**规则为开启；导入目标目录本身（已存在的）规则状态不变。
  - 导入角色卡后同上。
  - 回归：手动改过规则的已有目录，导入前后规则状态不变。
- **来源**: 用户口头追加 / round 1，round 2 重写改法

---

### P2

#### cr-a/C-01 — tryParseAnnotateChipText 与 tryParseRenamePairFromContent DRY

- **严重度**: P2
- **维度**: C（DRY）
- **文件**: `packages/core/src/domain/chat/logic/status-chip-label.ts`
- **问题**:
  `tryParseAnnotateChipText`（L245）和 `tryParseRenamePairFromContent`（L205）两处都是同一套「`/{[\s\S]*}/.exec(content)` → `JSON.parse` → try/catch 兜底返回 null」的骨架，复制粘贴。
- **改法**:
  抽一个内部 helper：
  ```ts
  function parseContentJson<T>(
    content: string | null | undefined,
    validate: (parsed: unknown) => T | null,
  ): T | null
  ```
  helper 负责「空值短路 → 正则取 JSON 串 → `JSON.parse` → 投影 validate → catch 兜底 null」。两个调用方各自传 validate 投影函数：annotate 那边投影出 `string`（userAnnotation 优先 / 回落 originalText），rename 那边投影出 `{ from, to }`。
- **验收/测试**:
  - `status-chip-label.test.ts` + rename 相关测试仍全部通过。
  - 行为完全不变（含 trim、含 from/to/oldPath/newPath 兼容）。
- **来源**: review-scope-a / round 1

#### cr-a/B-01 — doc 补「多命中取首次」声明

- **严重度**: P2
- **维度**: B（边界声明）
- **文件**: `docs/Iterations/agent-subagent/annotate-location-label.md`
- **问题**:
  `estimateSoftRangeFromOriginalText` 内部用 `indexOf` 取首次命中位置，当原文在同一文件里重复出现时，算出来的行号可能是「第一次出现」而不是用户实际划词的那一次。doc 的「方案 1」段落没把这个边界声明出来，读的人会以为行号一定准。
- **改法**:
  在 doc「方案 1」段落补一句声明，大意是：「多命中时取首次出现位置，行号可能偏差；`padding=0` 仅作为模型阅读提示，不保证唯一」。代码逻辑可以不动——这条本来就是 doc 缺声明，不是 bug。
- **验收/测试**:
  - doc 审阅，确认声明补上了。
- **来源**: review-scope-a / round 1

#### cr-a/C-02 — `typeof draft` 改显式类型

- **严重度**: P2
- **维度**: C（命名/类型契约）
- **文件**: `packages/core/src/service/agent/logic/run-agent-turn.ts`
- **问题**:
  L290 那行写的是 `const enriched: typeof draft = { ...draft, ... }`，拿变量推导出来的类型当注解，读起来得倒回去看 `draft` 是什么类型才能懂。
- **改法**:
  import 真实的 `AnnotateDraft` 类型，改成 `const enriched: AnnotateDraft = { ... }`。类型来源是 `@/domain/chat/model/annotate-draft.schema.js` 里导出的 `SendAnnotateDraft`（或其对应类型别名），从 `buildAnnotateAttachmentFromDraft` 的入参类型反查即可确认。
- **验收/测试**:
  - 编译通过（`tsc --noEmit` 或仓库既有的 typecheck 脚本）。
  - 行为不变。
- **来源**: review-scope-a / round 1

#### cr-b/C-orch-1 — 4 个弹窗背景色未上移到 avoidingRoot

- **严重度**: P2
- **维度**: C-orch（键盘避让一致性）
- **文件**:
  - `apps/mobile/src/components/provider/AddModelModal.tsx`
  - `apps/mobile/src/components/provider/EditModelNameModal.tsx`
  - `apps/mobile/src/components/ui/TextPromptModal.tsx`
  - `apps/mobile/src/components/sheet/DirectoryRuleSheet.tsx`
- **问题**:
  这 4 个弹窗都加了 `KeyboardAvoidingView`，但 `avoidingRoot` 是个裸 `flex: 1` 没有背景色，遮罩色（`rgba(0,0,0,0.4)`）挂在内部 backdrop 上。键盘动画过程中，avoidingRoot 和 backdrop 之间可能漏出白条。`MessageEditModal` 已经把背景色提到 avoidingRoot 上修过了，这 4 个还是旧写法，不一致。
- **改法**:
  二选一：
  1. 参照 `MessageEditModal` 的做法，把 `rgba(0,0,0,0.4)` 提到 `avoidingRoot` 的 style 上，backdrop 去掉背景色。
  2. 抽一个 `ModalKeyboardAvoidingView` 组件，把这 5 个入口（含 MessageEditModal）统一收口。
  推荐方案 2，长期更省心；但本轮若想最小改动，方案 1 也行。
- **验收/测试**:
  - 4 个弹窗在键盘弹起 / 收起过程中无白条 / 透明带（Android 真机重点验）。
- **来源**: review-scope-b / round 1

#### cr-b/B-1 — SessionDetailScreen handleCompact 与聊天页行为不一致

- **严重度**: P2
- **维度**: B（行为一致性 / 错误处理）
- **文件**: `apps/mobile/src/screens/stack/SessionDetailScreen.tsx`
- **问题**:
  新增的 `handleCompact` 跟聊天页的压缩入口对不齐，差了三处：
  1. 缺「Agent 运行中无法压缩」的前置守卫（聊天页有）；
  2. Alert 文案不一样（详情页是「减少上下文占用。是否继续？」，聊天页是「将按照事件配置压缩上下文。是否继续？」）；
  3. 成功路径没调 `refreshComposerStatusAfterFloorOrCompaction`（聊天页调了）。
  参考入口在 `useChatTabMessages` 的压缩路径。
- **改法**:
  1. 把「Agent 运行中」守卫补上，跟聊天页一致。
  2. Alert 文案对齐成聊天页那版。
  3. 成功路径补 `refreshComposerStatusAfterFloorOrCompaction`；如果详情页场景下确实不该刷 composer status（比如详情页没有 composer），就加注释说明为什么不刷，别留个看起来漏掉的调用。
- **验收/测试**:
  - 详情页压缩入口的行为与聊天页一致：Agent 运行中拦截、文案一致、成功后状态刷新一致（或注释说明豁免）。
- **来源**: review-scope-b / round 1

#### cr-b/C-1 — ChatComposer onOpenMore 调用方仍传回调

- **严重度**: P2
- **维度**: C（死代码 / 范围蔓延）
- **文件**:
  - `apps/mobile/src/components/chat/ChatComposer.tsx`
  - `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx`
- **问题**:
  `ChatComposer` 里「更多」按钮的 JSX 已经注释掉了，但 `onOpenMore` prop 还留着，`ChatConversationPanel` 那边还在传 `onOpenMore={() => setSessionDrawerOpen(true)}`。这条回调永远不会被触发，却给人「还连着」的错觉。
- **改法**:
  把调用方传的 `onOpenMore` 一起注释掉或删掉。如果 `ChatComposer` 的 `onOpenMore` prop 短期内还会复活（比如要恢复更多按钮），就给 prop 标 `@deprecated` 并在注释里写清楚现状；否则连 prop 一起删干净。
- **验收/测试**:
  - 编译通过。
  - 无悬空回调（grep `onOpenMore` 应只在确实还在用的地方出现，或带明确 `@deprecated` 标注）。
- **来源**: review-scope-b / round 1

#### cr-b/C-2 — ChatMetaBar agent 列锁定无视觉提示

- **严重度**: P2
- **维度**: C（视觉一致性）
- **文件**: `apps/mobile/src/components/chat/ChatMetaBar.tsx`
- **问题**:
  `agentLocked` 声明了，但只有 model 列套了 `styles.agentLocked`（降透明度），agent 列没套。锁定状态下用户看不出 agent 列也不能切。
- **改法**:
  agent 列里显示 agent 名的 `Text` 也加上 `agentLocked && styles.agentLocked` 的 opacity，跟 model 列对齐。
- **验收/测试**:
  - 锁定状态下，agent 列和 model 列都有视觉提示（透明度降低）。
- **来源**: review-scope-b / round 1

#### cr-b/C-3 — 锁定判据重复 inline，应抽 helper

- **严重度**: P2
- **维度**: C（DRY / 类型）
- **文件**:
  - `apps/mobile/src/services/chat-agent-meta.ts`（helper 落点）
  - `apps/mobile/src/components/chat/ChatMetaBar.tsx`
  - `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx`
  - `apps/mobile/src/screens/stack/SessionDetailScreen.tsx`
- **问题**:
  `meta.hasDedicatedModel` 已经是 `boolean` 不是 optional 了，但 `ChatMetaBar`、`ChatConversationPanel` 还在写 `?? false`；agent/model 锁定判据在三处各写了一遍 inline。
- **改法**:
  1. 去掉多余的 `?? false`。
  2. 把锁定判据抽成 helper：`isAgentLocked(meta)` / `isModelLocked(meta)`，落在 `apps/mobile/src/services/chat-agent-meta.ts`，三处共用。
- **验收/测试**:
  - 编译通过。
  - 锁定行为不变（锁定 / 解锁两种状态下，UI 和可切性都跟改之前一致）。
- **来源**: review-scope-b / round 1

#### cr-b/C-4 — DirectoryRuleSheet 缩进层级未随 KAV 嵌套重排

- **严重度**: P2
- **维度**: C（可读性）
- **文件**: `apps/mobile/src/components/sheet/DirectoryRuleSheet.tsx`
- **问题**:
  包了 `KeyboardAvoidingView` / backdrop 之后，内部 JSX 的缩进层级没跟着上调，导致 JSX 树和缩进对不上，读起来很费劲。
- **改法**:
  纯格式化，按新的嵌套深度重排缩进。不改任何逻辑。
- **验收/测试**:
  - 编译通过。
  - JSX 层级与缩进清晰对应（人工 review）。
- **来源**: review-scope-b / round 1

#### cr-c/B-1 — exportingZip 死状态，导出可并发触发

- **严重度**: P2
- **维度**: B（正确性 / 并发）
- **文件**: `apps/mobile/src/components/vfs/VfsFileManager.tsx`
- **问题**:
  `exportingZip` 声明了，但只有 `setExportingZip` 在调用，没有任何地方读这个值——是个死状态。更糟的是 more 菜单的 `export-zip` 入口（L884 起）没有 Alert 拦截，也没有 disabled，用户连点多次会并发触发多次导出。
- **改法**:
  和 cr-c/C-1 收敛 `runExport` 的时候一起处理：在 `runExport` 入口加 `if (exportingZip) return;` 早退，或给导出按钮加 `disabled={exportingZip}`。两者选其一，建议早退（更稳，覆盖所有触发路径）。
- **验收/测试**:
  - 导出过程中再次点击导出（无论 entity 菜单还是 more 菜单），不会触发第二次 service 调用。
- **来源**: review-scope-c / round 1

#### cr-c/B-2 — KeyboardAvoidingView behavior 未做平台区分

- **严重度**: P2
- **维度**: B（平台行为）
- **文件**:
  - `apps/mobile/src/components/vfs/VfsFileManager.tsx`
  - `apps/mobile/src/screens/stack/ChatHistorySearchScreen.tsx`
  - `apps/mobile/src/screens/stack/SessionDetailScreen.tsx`
  - `apps/mobile/src/components/provider/AddModelModal.tsx`
  - `apps/mobile/src/components/provider/EditModelNameModal.tsx`
  - `apps/mobile/src/components/sheet/DirectoryRuleSheet.tsx`
  - `apps/mobile/src/components/ui/TextPromptModal.tsx`
- **问题**:
  本 PR 在 7 处硬编码 `behavior="padding"`（round 2 追踪发现原清单只列了 2 个文件，遗漏了 5 个）。RN 官方推荐 iOS 用 `'padding'`、Android 传 `undefined`，因为 Android 上 padding 模式可能让根视图高度收缩异常。
- **改法**:
  统一改成 `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`。
  备选：如果在 Android 真机上验证过 padding 模式也 OK，可以不改代码，但必须在每个文件注释里写明「已在 Android 真机验证，padding 模式无异常」，免得后人再来踩一遍。
- **验收/测试**:
  - iOS / Android 双端键盘弹起 / 收起时布局正常，无高度异常收缩；7 个文件逐一回归。
- **来源**: review-scope-c / round 1，round 2 扩文件清单

#### cr-c/C-2 — 错误文案不统一

- **严重度**: P2
- **维度**: C（一致性）
- **文件**: `apps/mobile/src/components/vfs/VfsFileManager.tsx`
- **问题**:
  toast 文案混用：prompt submit 用 `'失败'`、entity 菜单导入用 `'导入失败'`、catch 顶层用 `'操作失败'`。同一个动作失败，用户看到的提示不一样。
- **改法**:
  和 cr-c/C-1 抽 `runImport` / `runExport` helper 时一起统一：导入失败统一前缀（如「导入失败」），导出失败统一前缀（如「导出失败」），prompt submit 这种通用动作保持「操作失败」或按动作语义命名。统一后写进 helper，调用方不再各写各的。
- **验收/测试**:
  - 导入 / 导出失败时 toast 前缀一致（同一类动作同一前缀）。
- **来源**: review-scope-c / round 1

#### cr-x/H-1 — ChatMetaBar 无障碍语义缺失

- **严重度**: P2
- **维度**: H（无障碍）
- **文件**: `apps/mobile/src/components/chat/ChatMetaBar.tsx`
- **问题**:
  本 PR 把 agent/model 两段从裸 `View` 改成了 `Pressable`，但没补 `accessibilityRole="button"` / `accessibilityLabel` / `accessibilityState={{ disabled }}`。锁定态下读屏用户既听不到「这是按钮」，也听不到「已禁用」，可操作性信息丢了。
- **改法**:
  - agent Pressable 补：`accessibilityRole="button"`、`accessibilityLabel={`切换智能体，当前 ${meta.agentName}`}`、`accessibilityState={{ disabled: !onPressAgent }}`。
  - model Pressable 同样补上对应三属性（label 用 `meta.modelName`，disabled 判据用 `!onPressModel`）。
- **验收/测试**:
  - Android TalkBack / iOS VoiceOver 朗读正确，能识别为按钮；锁定态读出「已禁用」。qa: manual_user。
- **来源**: review-full / round 2

---

## Spec deviations

### 文件夹菜单「导入角色卡」入口 — 关闭（按现状收窄）

- **条目**: entity 菜单（目录项右键）新增「导入角色卡」（`VfsFileManager.tsx` L541）。
- **评审意见**: 偏离原 spec（原 spec 只在 more 菜单放导入角色卡）。
- **用户确认**: 有意添加（用户原话：「1 特意加的」）。
- **结论**: 关闭，按现状收窄。本 spec 不要求改这块入口结构。

---

## Open questions / 待拍板

### RealPrompt 单屏关转场动画 — 关闭（用户确认有意）

- **条目**: 仅提示词（RealPrompt）预览页关闭了转场动画，其它页面不变。
- **评审意见**: 与全站动画策略不一致，疑问是否漏改。
- **用户确认**: 有意为之（用户原话：「2 故意的，这样提高性能，其他先不变」）。
- **结论**: 关闭。本 spec 不涉及转场动画改动。

### OQ-3 — run-agent-turn 补算分支测试覆盖确认

- **条目**: `run-agent-turn.ts` 里 draft 缺 `startLine` 时调 `estimateSoftRangeFromOriginalText` 的补算分支。
- **背景**: `annotate-drafts-send.test.ts` 本轮加了 262 行，但需确认是否覆盖了这条新分支。
- **结论/行动**: 待下游确认。如未覆盖，应补一条 P2 must-fix（在合并前补上针对 `estimateSoftRangeFromOriginalText` 被触发场景的单测）。
- **来源**: review-full / round 2

---

## 已豁免（用户确认不修）

本轮无。

---

## 合并后 QA（manual_user）

以下项需要在合并后由真机 / 人工验收，单测覆盖不到：

- **MessageEditModal 键盘避让白条**：Android 真机验收键盘弹起 / 收起过程无白条、无透明带。（本分支已修 MessageEditModal；cr-b/C-orch-1 涉及的另外 4 个弹窗修完后一并回归。）
- **导入 zip / 角色卡目录规则默认开启**（cr-c/REQ-1）：真机验收导入后新目录的规则为开启状态；已有目录规则状态不被影响。
- **导出并发拦截**（cr-c/B-1）：真机连点导出按钮，确认不会触发第二次导出。
- **键盘 behavior 平台区分**（cr-c/B-2）：Android 真机验收键盘弹起 / 收起布局正常。
- **ChatMetaBar 锁定视觉**（cr-b/C-2）：锁定状态下 agent 列与 model 列都有透明度提示。
- **SessionDetailScreen 压缩入口**（cr-b/B-1）：Agent 运行中点压缩应被拦截；文案与聊天页一致。
- **ChatMetaBar 无障碍语义**（cr-x/H-1）：Android TalkBack / iOS VoiceOver 朗读 agent/model 按钮正确，锁定态读出「已禁用」。

---

## K 节建议（下游执行时闭合）

- **lint / format 检查**：所有改动文件跑一遍仓库既有的 lint + format（eslint / prettier / tsc），尤其 cr-b/C-4（DirectoryRuleSheet 缩进重排）和 cr-a/C-02（import 新类型）这两条容易漏 format。
- **typecheck**：cr-a/C-02、cr-b/C-3 涉及类型契约变更，跑全仓 `tsc --noEmit` 确认没破坏别处。
- **测试**：cr-a/G-01 是 P0，必须先把测试跑绿再合并；cr-a/C-01 改完跑 status-chip-label + rename 相关测试。
- **回归**：cr-c/C-1 收敛导入导出后，六条路径手动走一遍（见该条验收），别只信单测。
