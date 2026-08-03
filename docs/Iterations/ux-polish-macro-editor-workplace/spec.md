---
date: 2026-07-20
---

# 宏 Tag、文件编辑滑动与 Workplace 统一 技术规格（SPEC）

> **需求来源**：`Iterations/ux-polish-macro-editor-workplace/prd.md`  
> **探索依据**：2026-07-20 四路只读探索（宏 Tag / FileEditor / Agent workplace 协议 / worktree 全仓改名）  
> **局部 supersede**：`agent-worktree-block-ui`（不再以 persist 块表达开关）、`message-attachment-unified`（不再保留 Agent wire `type:"worktree"`）

## 设计目标

1. **宏 Tag**：Desktop + Mobile 动态区白名单宏（含手输）着色 + Backspace/Delete 整段删；落库纯 `{{$…}}`。
2. **FileEditor**：未聚焦滑动不弹软键盘；点正文聚焦；全 `scopeKind`；Android + iOS。
3. **Workplace**：`prompts.workplace: boolean`；旧 `type:worktree` strip 忽略；全仓 worktree→workplace（含 IPC/CLI/SQL）；不改 `workspace*` / 历史 `.apm` / `$filetree` / 附件 `source:"workplace"`。

## 总体方案

三项互不阻塞，建议 **三轨并行、发版前汇合**；Workplace 轨内再分 C0–C4（协议 → 符号 → 对外 API → 表 → 扫尾）。

```text
Track A 宏 Tag ─────────────┐
Track B FileEditor ─────────┼──► 合并验收 / 发版说明
Track C Workplace C0…C4 ────┘
```

### Track A — 动态区宏 Tag

| 端 | 方案 |
|----|------|
| **Desktop** | 抽 `PromptMacroTextarea`：透明 `textarea` + 高亮层（模式对齐 `ComposerAtPathInput`，**独立 CSS class**）；高亮仅白名单完整 token；`keydown` 或前后值差分做整段删；`value` 始终纯文本 |
| **Mobile** | 改造 `PromptMacroTextInput`：收紧 `splitPromptMacroSegments` 为白名单；`TextInput` children 着色；`onChangeText` 仿 `tryAtomicMentionDelete`；全文扫描将**已完整**白名单宏视为可原子删区间（含手输） |
| **双端** | 非法/残缺 `{{…}}` 普通文本；不改 Composer；不改 Core `validateDynamicMacros` 语义（可选导出只读白名单常量给 UI） |

白名单 token（与芯片一致）：`{{$time}}` / `{{$week_cn}}` / `{{$filetree}}`。合法判定建议与 `scanMacroActions` + `ALLOWED_ROOT_MACROS` 对齐（允许内文 trim 后同 root，span 仍为完整 `{{`…`}}`）。

### Track B — FileEditor 滑动 / 键盘

采用 **`editorFocused` 双态**（禁止「外层 ScrollView 包可编辑 TextInput」——与 `mobile-message-edit-multiline` 短框反模式同构）：

| 态 | UI | 行为 |
|----|-----|------|
| 未聚焦（进编辑默认） | `ScrollView` + `Pressable` + `Text`（字号/字族对齐编辑态） | 滑动不弹键盘 |
| 聚焦 | 独占 `TextInput` `multiline` `flex:1`，**`scrollEnabled={true}`**，`showSoftInputOnFocus` | 点正文进入；输入区内滚动不强制收键盘；`onBlur` / 切预览 → 回未聚焦 + `Keyboard.dismiss` |

改动集中在 `FileEditorScreen.tsx`；三 `scopeKind` 共屏，一次覆盖。

### Track C — Workplace 协议 + 全仓改名

| Step | 内容 |
|------|------|
| **C0** | `AgentPromptLayout.workplace?: boolean`；zod preprocess strip `type:worktree`（**不**升 true）；GUI Switch↔boolean；`assemble`/`render-prompt` 门闩改读 boolean；LLM 合成消息 id → `prompt:workplace` / `prompt:workplace:done`；预览 segment id → `prompt-workplace` / `prompt-workplace-done`（替代 `prompt-worktree-${name}` / `-done`） |
| **C1** | 目录/符号/`@novel-master/core/worktree`→`workplace`；SQL 字面量可暂抽常量仍指向旧表名 |
| **C2** | `rt.workplace`、IPC `nm:workplace/*`、CLI `… workplace`（无长期别名） |
| **C3** | 表 `worktree_*`→`workplace_*` + `schema_migrations`；canonical DDL 同步 |
| **C4** | 测录/文件名扫尾；ripgrep 门禁；发布说明 |

**冻结**：`workspace*`、`.apm` 历史迭代文档、`$filetree`、`source:"workplace"` / `workplaceChange`、git。

## 最终项目结构（增量）

```text
packages/core/
  src/domain/prompt/model/agent-prompt-layout.ts     # +workplace; persist 仅 text
  src/domain/agent/model/agent-definition.schema.ts  # preprocess strip worktree
  src/domain/workplace/…                             # 自 domain/worktree 迁入（C1）
  src/service/workplace/…                            # 合并原 service/worktree + assemble
  src/public/workplace.ts                            # 原 public/worktree.ts
  src/bootstrap/workplace/…                          # 原 bootstrap/worktree
  src/bootstrap/schema-migrations/
    rename-worktree-tables-to-workplace-v1.ts        # 新增（C3）
  src/config-forms/agent/agent-editor-state.ts       # Switch↔workplace

apps/desktop/renderer/features/settings/
  PromptMacroTextarea.tsx                            # 新增：叠层+原子删
  AgentDefinitionEditorForm.tsx / AgentEditorView.tsx # 接入

apps/mobile/src/components/agent/
  PromptMacroTextInput.tsx / prompt-macro-input.ts   # 白名单分段+原子删

apps/mobile/src/screens/stack/FileEditorScreen.tsx   # editorFocused 双态

apps/cli/src/…/workplace.ts                          # 原 worktree 子命令
apps/desktop/…/ipc/handlers/workplace.ts             # 原 worktree handler
```

## 变更点清单

### A. 宏 Tag

| 文件 | 变更 |
|------|------|
| `apps/mobile/.../prompt-macro-input.ts` | 白名单分段；`tryAtomicMacroDelete`；导出供测 |
| `apps/mobile/.../PromptMacroTextInput.tsx` | 着色 + 原子删 + 手输完整即 tag |
| `apps/desktop/.../PromptMacroTextarea.tsx` | **新建** |
| `AgentDefinitionEditorForm.tsx` / `AgentEditorView.tsx` | 动态区改用公共组件；删重复 `DYNAMIC_MACROS`/`insertAtCursor` |
| `shell.css` | `.prompt-macro__*` 叠层/tag（勿复用 chat-composer class 以免耦合） |
| 测试 | 扩展 `prompt-macro-input.test.ts`；新建 desktop `prompt-macro*.test.ts` |

### B. FileEditor

| 文件 | 变更 |
|------|------|
| `FileEditorScreen.tsx` | `editorFocused`；browse/focus 分支；testID |
| 新建测（建议） | `file-editor-screen.test.tsx` 锁结构 props |

### C. Workplace

| 层 | 变更 |
|----|------|
| Core layout/schema/validate/wire/editor-state | C0 |
| assemble / render-prompt / runner | 门闩 + LLM 消息 id + 预览 segment id |
| domain/service/public/bootstrap | C1 迁名 |
| Desktop IPC + Mobile services + CLI | C2 |
| SQL + migration | C3 |
| 全仓 import / 测试路径 | C1–C4 |

## 兼容性与迁移

### Agent 配置

| 读入 | 行为 |
|------|------|
| 无 `workplace` | `false` |
| `persist` 含 `type:worktree` | **strip 丢弃**，不设 `workplace:true` |
| `workplace:true` + 旧块并存 | 块丢弃，开关保持 true |
| 写出 | 仅 text persist + `workplace`（false 可 omit，对齐 `persistEnabled` 风格） |

挂靠：`promptsDocumentSchema` preprocess + `validateAgentPromptLayoutFromMaps` 双保险。

**域存储捷径归一化（blocking）**：`resolveAgentDefinitionFromStorage` 对 `isAgentDefinitionDomainShape` 当前直通、不跑 schema preprocess。须在 **storage resolve 内**（decode 后、返回 `valid` 前）对领域对象执行与 C0 等价的 strip：丢弃 `type:worktree` 块、**不**据此设 `workplace:true`；`persist` 仅保留 text；`workplace` 缺省 `false`。测例见 T-W9。

### SQL（C3）

新增 migration `rename-worktree-tables-to-workplace-v1`：

1. 探测 `worktree_dir_rule` / `workplace_dir_rule`（及 file 表）存在性。
2. **仅旧表**：`ALTER TABLE … RENAME TO workplace_*`；索引 drop+create 或 rename。
3. **仅新表**（canonical DDL 已建）：no-op。
4. **双表并存且新表空、旧表有数据**：`DROP` 空新表 → `RENAME` 旧表（写死路径，加 bootstrap 单测）。
5. **双表均有数据**：fail-fast。

Canonical `WORKPLACE_SCHEMA_STATEMENTS` 只 `CREATE IF NOT EXISTS workplace_*`。`alignSchemaColumns` **不**承担 rename。

### 对外破坏（接受）

- CLI：`worktree` → `workplace`（无 alias）
- IPC：`nm:worktree/*` → `nm:workplace/*`
- Package：`@novel-master/core/worktree` → `@novel-master/core/workplace`
- 发布说明：旧开启 worktree 块的 Agent 需手动打开「常驻工作区」

## 详细实现步骤

### Track A — 宏 Tag

- Step 1 — phase-macro-core-fns — blocking: yes — qa: auto：收紧 Mobile `splitPromptMacroSegments`（仅白名单）；新增 `tryAtomicMacroDelete`（及可选 `findWhitelistMacroRanges`）；单测覆盖芯片形态、手输完整、非法/残缺、半输入不成 tag（→ T-M1…T-M4）。**实现注（P2）**：白名单 token 与 Core `ALLOWED_ROOT_MACROS` / `scanMacroActions` 对齐，优先从 Core 导出只读常量作为 UI 单一真相源，避免 Desktop/Mobile 各维护一份。
- Step 2 — phase-macro-mobile-ui — blocking: yes — qa: auto：`PromptMacroTextInput` 接线着色 + 原子删；落库路径断言无内部 markup（→ T-M1, T-M5）
- Step 3 — phase-macro-desktop-component — blocking: yes — qa: auto：新增 `PromptMacroTextarea`（叠层 + 整段删）；纯函数/渲染契约测（HTML 有 class、value 无 span）（→ T-M2, T-M5）。**实现注（P2）**：补 Desktop `Delete` 键整段删测例（与 Backspace 对称）。
- Step 4 — phase-macro-desktop-wire — blocking: yes — qa: auto：`AgentDefinitionEditorForm` + `AgentEditorView` 接入公共组件；删除重复插入逻辑（→ T-M2）
- Step 5 — phase-macro-manual — blocking: no — qa: manual_user：双端真机/桌面：芯片插入与手输宏退格整段删观感（合并后用户）

### Track B — FileEditor

- Step 6 — phase-file-editor-dual-mode — blocking: yes — qa: auto：`FileEditorScreen` 实现 `editorFocused` 双态 + testID；**browse 分支无可聚焦 `TextInput`**；**聚焦分支 `TextInput` 须 `scrollEnabled={true}`**；单测：进编辑默认 browse；press → input；blur/切预览回 browse；预览分支不变（→ T-F1…T-F4, T-F6 结构断言）
- Step 7 — phase-file-editor-manual — blocking: no — qa: manual_user：Android+iOS × session/project/global 长文：未聚焦滑动不弹键盘；点正文可编可存；**已聚焦时在输入区内滚动不强制收键盘**（→ T-F5, T-F6 真机）

### Track C — Workplace

- Step 8 — phase-workplace-layout-c0 — blocking: yes — qa: auto：领域模型 + schema preprocess strip + validate + wire；**LLM 合成消息 id** 改为 `prompt:workplace` / `prompt:workplace:done`；**预览 segment id**（`render-prompt.ts` `appendWorkplacePairSegmentsIfPresent`，自 `appendWorktreePairSegmentsIfPresent` 更名）改为固定 `prompt-workplace` / `prompt-workplace-done`（不再 `${block.name}` 后缀）；`layoutHasWorkplace`（或等价）替换块检测；`resolveAgentDefinitionFromStorage` 域形态归一化（挂载点见「兼容性与迁移」）；assemble/render/runner/测试全绿（→ T-W1…T-W6, T-W5b, T-W9）。**实现注（P2）**：`validateDynamicMacros` 错误文案去除「工作树/worktree 块」措辞，改为 workplace 或中性 persist 表述。
- Step 9 — phase-workplace-editor-ui — blocking: yes — qa: auto：`agent-editor-state` 全量迁移（见下表）+ Desktop/Mobile Switch ↔ `workplace` boolean；常量符号 `WORKPLACE_BLOCK_*`（用户可见文案不变）；删除 add/remove worktree 块 API 及 GUI 接线（→ T-W4, T-W6, T-W7, T-W8）

**Step 9 — `agent-editor-state` 迁移清单（全量）**

| 符号 / 文件 | 现网 | 目标 |
|-------------|------|------|
| `AgentEditorFormInput` | 无 `workplace` | 新增 `workplace: boolean` |
| `createDefaultAgentEditorPrompts` | 无 `workplace` | 默认 `workplace: false` |
| `definitionToForm` | 原样拷贝 `persist`（可含 worktree 块） | 读 `def.prompts.workplace ?? false`；`persist` 仅 text（strip worktree） |
| `layoutFromFormInput` | 经 `splitPersistBlocksForEditor` 写回 blocks | 写 `workplace` boolean；`persist` 仅 text 块 |
| `formSnapshotJson` | 无 `workplace` | 纳入 `workplace` 参与脏检查 |
| `countFormPromptSources` | 计 worktree 块（`excludeWorktree` 选项） | 计 `input.workplace === true`；删除 `excludeWorktree` |
| `hasEffectivePromptSource` / `countEffectiveFormPromptSources` | 不计 workplace | workplace 开时计 1 个有效来源（与现网 worktree 块等价） |
| `splitPersistBlocksForEditor` | 返回 `{ blocks, textBlocks, worktree }` | 仅 text；删除 `worktree` 分支与返回值 |
| `normalizePersistBlock` | worktree 分支 | 删除；仅 text |
| `blockTypeLabel` | `worktree` → 标签 | 删除 worktree 分支 |
| `joinPersistBlocksForLayout` | 含 deprecated `(textBlocks, worktree)` 重载 | 仅 `(blocks)` 单签名 |
| `addPersistWorktreeBlock` / `removePersistWorktreeBlock` | 增删 persist worktree 块 | **删除** |
| `createDefaultWorktreeBlock` / `updatePersistWorktreeRole` | 存在 | **删除** |
| `WORKTREE_BLOCK_*` 常量 | worktree 命名 | 重命名为 `WORKPLACE_BLOCK_*`（label/hint 文案不变） |
| `mapPersistTextBlocks` / `movePersistBlock` 等 | 遍历 blocks 时跳过/保留 worktree | 仅 text 路径；删除 worktree 特殊分支 |
| Desktop `AgentEditorView` / `AgentDefinitionEditorForm` | Switch → add/remove worktree 块 | Switch ↔ `input.workplace` |
| Mobile `AgentEditorForm` | 同上 | 同上 |
| 测例 `buildAgentDefinitionFromForm allows worktree-only…` | worktree 块 + 全开关关 → 可保存 | **替换为 T-W8**：`workplace:true` + system/persist/dynamic 全关 → 可保存 |

- Step 10 — phase-workplace-rename-c1 — blocking: yes — qa: auto：目录/符号/package export/`public/workplace`；全仓 import；allowlist snapshot；测试路径跟迁（SQL 字面量可仍旧表名）（→ T-R1）
- Step 11 — phase-workplace-api-c2 — blocking: yes — qa: auto：`rt.workplace`、IPC `nm:workplace/*`、CLI 子命令与 e2e（→ T-R2, T-R3）
- Step 12 — phase-workplace-sql-c3 — blocking: yes — qa: auto：canonical DDL + `rename-worktree-tables-to-workplace-v1` + repository SQL；legacy fixture 升级测（→ T-R4）
- Step 13 — phase-workplace-sweep-c4 — blocking: yes — qa: auto：工程源码 ripgrep 门禁（无 `nm:worktree`、无 `@novel-master/core/worktree`、无 `worktree_dir_rule` 于非 migration 旧名探测字符串外）；保留 `workspace`/`$filetree`/`source:"workplace"`；GUI 无「工作树」指代本能力（→ T-R5）
- Step 14 — phase-release-notes — blocking: no — qa: manual_user：发版说明：旧 Agent 重开常驻工作区；CLI/IPC 破坏性改名清单

**建议合并顺序**：Step 1–4 ∥ Step 6 ∥ Step 8–9 → Step 10 → Step 11 → Step 12 → Step 13 → 人工 Step 5/7/14。

## 测试策略

| 轨 | 自动 | 人工 |
|----|------|------|
| A | 纯函数 + Desktop 高亮契约 + Mobile 组件测 | 双端编辑器手感 |
| B | Screen 结构/状态机 | 真机键盘矩阵 |
| C | core layout/render/assemble/editor-state；IPC/CLI；migration | 发版说明核对 |

### 测试用例

#### 宏（T-M*）— Step 1–4

- T-M1 — blocking: yes — 芯片插入 `{{$time}}` 后一次退格整段删（Mobile）（→ Step 1–2）
- T-M2 — blocking: yes — 同上 Desktop（→ Step 3–4）
- T-M3 — blocking: yes — 手输完整 `{{$week_cn}}` 成 tag 且可整段删（双端纯函数或 UI）（→ Step 1–4）
- T-M4 — blocking: yes — 残缺/非白名单 `{{…}}` 不整段删（→ Step 1）
- T-M5 — blocking: yes — 保存/onChange 对外值为纯 `{{$…}}`，无 HTML/mention markup（→ Step 2–3）

#### FileEditor（T-F*）— Step 6–7

- T-F1 — blocking: yes — 切到编辑后默认存在 browse scroll testID，无可聚焦编辑 input（或等价未聚焦）（→ Step 6）
- T-F2 — blocking: yes — press browse → 出现可编辑 input（→ Step 6）
- T-F3 — blocking: yes — input blur 或切预览 → 回 browse + dismiss 键盘路径（→ Step 6）
- T-F4 — blocking: yes — 预览分支仍可渲染（回归）（→ Step 6）
- T-F5 — blocking: no — 真机：三 scope × 双 OS 长文未聚焦滑动不弹键盘（→ Step 7）
- T-F6 — blocking: no — 聚焦态：Step 6 单测断言 browse 无可聚焦 input、聚焦 input `scrollEnabled={true}`；真机（可并入 Step 7 矩阵）已聚焦时在输入内容区内纵向滚动不强制收键盘（→ Step 6–7；对应 PRD B 第三条）

#### Workplace 协议（T-W*）— Step 8–9

- T-W1 — blocking: yes — 无 `workplace` 字段 → false；assemble 空串、不写 kkv；不注入双消息（→ Step 8）
- T-W2 — blocking: yes — `workplace:true` + `persistEnabled:false` → 仍注入 user+done（→ Step 8）
- T-W3 — blocking: yes — 旧 `type:worktree` 无 workplace → strip 后 false，不注入（→ Step 8）
- T-W4 — blocking: yes — 旧块 + `workplace:true` → 块丢弃、开关开（→ Step 8–9）
- T-W5 — blocking: yes — **LLM 运行时**合成消息 id 为 `prompt:workplace` / `prompt:workplace:done`（→ Step 8）
- T-W5b — blocking: yes — **预览** segment id 为 `prompt-workplace` / `prompt-workplace-done`（`buildPromptAssemblyFromLayout` / 原 `appendWorktreePairSegmentsIfPresent` 路径；不再使用 `prompt-worktree-${name}`）（→ Step 8）
- T-W6 — blocking: yes — 写出 wire 无 `type:worktree`（→ Step 8–9）
- T-W7 — blocking: yes — GUI/form Switch round-trip `workplace` boolean（→ Step 9）
- T-W8 — blocking: yes — `workplace:true` 且 system/persist/dynamic 区域开关全关 → `buildAgentDefinitionFromForm` 仍 `ok:true`（替代现网 worktree-only 块用例）（→ Step 9）
- T-W9 — blocking: yes — **域存储捷径**：`resolveAgentDefinitionFromStorage` 输入已解析领域对象且 `persist` 含 `type:worktree`、无 `workplace:true` → 归一化后 `workplace===false`、`persist` 仅 text、assemble/render **不**注入双消息/双 segment（→ Step 8）

#### 改名（T-R*）— Step 10–13

- T-R1 — blocking: yes — `@novel-master/core/workplace` 可导入；旧 `./worktree` export 移除（→ Step 10）
- T-R2 — blocking: yes — IPC channel 均为 `nm:workplace/*`（→ Step 11）
- T-R3 — blocking: yes — CLI `workplace list|display|dir|file` e2e 绿；旧子命令名不存在（→ Step 11）
- T-R4 — blocking: yes — legacy DB 含 `worktree_*` 规则行 → bootstrap 后数据在 `workplace_*` 且 CRUD 正常；新库只建新表（→ Step 12）
- T-R5 — blocking: yes — ripgrep 门禁：工程源无用户向 `worktree` 能力标识残留（migration 探测旧名字符串除外）；`workspace`/`$filetree`/`source:"workplace"` 仍在（→ Step 13）

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 旧 Agent 常驻区静默关闭 | 发版说明；产品已接受 | 无法自动恢复开启态；用户手动开 Switch |
| Desktop 宏叠层 caret/滚动错位 | 独立 CSS；对照 Composer 末行 `<br/>` 技巧 | 回退为纯 textarea（丢 tag，保留插入芯片） |
| Mobile IME 半输入误成 tag | 仅完整白名单 span 才原子化 | 收紧匹配 |
| FileEditor 双态丢滚动位置 | P2 恢复 offset；非门禁 | 可接受跳动 |
| SQL rename 与 `CREATE IF NOT EXISTS` 撞空新表 | migration 路径 A/B 写死 + fixture 测 | 发版前备份；反向 migration 成本高，优先修 forward |
| IPC/CLI 破坏外部脚本 | 发版清单；无 alias（PRD） | 发版回滚整包 |
| 误改 `workspace*` | Step 13 门禁白名单保留 `workspace` | code review 清单 |

## Context Bundle

```yaml
iteration_name: ux-polish-macro-editor-workplace
requirement_path: Iterations/ux-polish-macro-editor-workplace/prd.md
spec_path: Iterations/ux-polish-macro-editor-workplace/spec.md
explore_summary: |
  宏：双端纯文本；splitPromptMacroSegments 过宽未接线；Desktop 仿 Composer 叠层+自建原子删；Mobile 仿 tryAtomicMentionDelete+手输提升。
  FileEditor：全屏 TextInput 根因；推荐 editorFocused 双态；勿照搬 MessageEditModal 禁 SV。
  Workplace：C0 boolean+strip；消息 id 改 prompt:workplace；C1–C4 全仓改名；SQL 走 schema_migrations。
impact_files:
  - apps/mobile/src/components/agent/PromptMacroTextInput.tsx
  - apps/mobile/src/screens/stack/FileEditorScreen.tsx
  - apps/desktop/renderer/features/settings/PromptMacroTextarea.tsx
  - packages/core/src/domain/agent/model/agent-definition.schema.ts
  - packages/core/src/service/workplace/**
  - packages/core/src/bootstrap/schema-migrations/rename-worktree-tables-to-workplace-v1.ts
constraints:
  - 不改 Composer @path；不改 workspace*；不回写历史 .apm
  - 旧 type:worktree 忽略不升迁；无 CLI/IPC 长期别名
  - persist 仅 text；附件 source:workplace 保持
blocking_steps:
  - Step 1–4, 6, 8–13
```
