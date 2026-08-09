# L9：死代码 & 迭代残留

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**死代码、迭代残留、未使用导出**这一个角度扫遍整个仓库。
>
> **与 L1-L8 的根本区别**：你的主要数据源不是 grep，而是 **knip 扫描报告**（[`phase0/D0-3-knip-scan.md`](../phase0/D0-3-knip-scan.md) + 原始输出 [`phase0/knip-raw-output.txt`](../phase0/knip-raw-output.txt)）。knip 已经做了引用图分析，你的工作是**核实和判断**——knip 说的对不对、能不能删、有没有 Iteration 对应。

## 你的一句话职责

核实 knip 报告里的每一条，区分**真死代码**和**误判**，找出迭代重构后没清理干净的残留。你不重新扫描代码——knip 已经扫过了，你的价值在于**语义判断**：这条为什么存在、对应哪个 Iteration、该不该删。

## Phase 0 已确认的扫描结果

knip 6.31.0 已跑完全仓库，原始输出 1015 行存于 [`phase0/knip-raw-output.txt`](../phase0/knip-raw-output.txt)，分析报告存于 [`phase0/D0-3-knip-scan.md`](../phase0/D0-3-knip-scan.md)。**核心结论**：

### 总览数字

| 类别 | 总数 | 在 core | 在 apps |
|------|------|---------|---------|
| Unused files | 174 | **2** | 172 |
| Unused exports | 451 | ~23 | ~428 |
| Unused exported types | 151 | ~23 | ~128 |
| Unused dependencies | 10 | 0 | 10 |
| Unused devDependencies | 19 | 1 | 18 |
| Duplicate exports | 5 | 3 | 2 |
| Unresolved imports | 107 | 0 | 107 |

### 你的工作重心分配

**packages/core/src（轻量，~30 分钟）**：
- core 几乎没有死代码，只有 **2 个 unused files + ~23 个 unused exports/types + 3 个 duplicate exports**
- 这些是高价值目标——每一条都值得逐个核实，因为 core 的死代码影响所有端

**apps 端侧（重量，但需先排误判）**：
- knip 报的 172 个 unused files 里，**大部分是误判**（见下「knip 误判清单」）
- 排除误判后，真实死代码约 **desktop renderer ~24 个 + mobile ~9 个**
- 你需要先识别误判，再核实真实死代码

### knip 误判清单（不追这些）

以下 knip 告警**几乎肯定是配置问题，不是死代码**，你只需在报告里标注「误判」并说明原因，不逐个核实：

| 类别 | 数量 | 误判原因 |
|------|------|----------|
| `apps/desktop/test/**` | 74 | desktop 测试通过自定义 runner 执行，knip 找不到入口 |
| `apps/mobile/e2e/**` | 17 | wdio 配置入口 knip 不认识 |
| `apps/mobile/src/web/*/webview/**` | ~35 | webview 代码通过 bundler 入口加载，不走 import 链 |
| Unresolved imports（全 `@/` 别名） | 107 | knip 不认识 desktop renderer 的路径别名 |
| `@codemirror/*` devDeps | 6 | mobile code-editor 用，但 code-editor 被 knip 误判为 unused |

## 你的独有抓手

以下是只有 L9 能抓到、别的角度看不到的：

- **迭代残留**：代码文件还在，但对应的 Iteration 已经把功能移除/替代了。典型：`remove-mobile-vfs-zip-native` 后 vfs zip 类型没清理
- **重复导出**：同一个符号被 export 两次（不同名字），或者 alias 互相重复。knip 报为 Duplicate exports
- **类型残留**：定义了 output/result 类型但没人生产或消费这些类型的实例
- **常量废弃**：`CONTEXT_WINDOW_RULES` 这种常量在 model-aware-token-counting 后可能不再使用
- **依赖幽灵**：package.json 里挂了但没人 import 的 npm 依赖

## 逐条核实清单（core，必做）

### 2 个 Unused files

读这两个文件，找对应的 Iteration，判断是否真的可以删除：

1. **`packages/core/src/domain/chat/logic/resolve-current-workspace-snapshot.ts`**
   - 疑似迭代：`chat-send-render-refactor`、`message-rollback-execution-redesign`
   - 你要查：这个函数的逻辑是否被别处内联了？对应的 spec 有没有「移除」步骤？

2. **`packages/core/src/domain/chat/logic/resolve-flush-baseline-tree.ts`**
   - 同上，疑似 flush 相关重构的遗留

### ~23 个 Unused exports/types（按主题分组核实）

**主题一：vfs zip 残留（高嫌疑）**
```
VfsZipIoService        packages/core/src/service/vfs/vfs.port.ts
VfsZipImportOptions    packages/core/src/service/vfs/vfs.port.ts
```
- 对应 Iteration：`remove-mobile-vfs-zip-native`、`vfs-zip-native-compression`、`vfs-zip-io-agent-tool-policy`
- 你要查：vfs zip 原生压缩移除后，这些类型还有没有消费者？是否只剩类型定义？

**主题二：tokenizer 常量废弃**
```
CONTEXT_WINDOW_RULES          packages/core/src/infra/tokenizer/index.ts
DEFAULT_CONTEXT_WINDOW_TOKENS packages/core/src/infra/tokenizer/index.ts
registerTokenizerDriver       packages/core/src/infra/tokenizer/index.ts
ForVendorModelOptions         packages/core/src/infra/tokenizer/index.ts
```
- 对应 Iteration：`model-aware-token-counting`、`token-counting`、`nmtp`
- 你要查：model-aware 改造后这些常量是否被新的计数逻辑取代？

**主题三：tool 输出类型残留**
```
ReadToolOutput, GrepToolOutput, GlobToolOutput, VfsReadResult, VfsToolContext, ChatGrepMatch
```
- 对应 Iteration：`tool-system-v2`、`tool-result-block-ok`
- 你要查：tool v2 是否引入了新的输出类型，旧的没人用了？

**主题四：vfs 类型重复导出**
```
VfsEntryKind（在 3 个文件里重复）
VfsGrepMatchMode（在 3 个文件里重复）
BatchIngestTypeConflict
```
- 你要查：为什么同一个类型在 model/port/service 三层都导出？是 re-export 链还是真的定义了三次？
- 这个和 L3（架构）交叉——re-export 链过长是架构问题

**主题五：事件/模板类型**
```
NovelMasterEventPayload  events/model/event-types.ts
MacroActionKind          infra/prompt-template/macro-scan.ts
ForeachAttrs, TrimAttrs  infra/sql-template/index.ts
```
- 你要查：这些类型定义了但没人用——是预留的还是废弃的？

### 3 个 Duplicate exports（core）

```
BUILTIN_PROVIDER_KEYS | BUILTIN_PROVIDER_IDS    domain/provider/logic/builtin-providers.ts
savedModelSettingsSchema | ...                   saved-model-settings.schema.ts
MUTATING_FILE_TOOL_NAMES | MUTATING_VFS_TOOL_NAMES  domain/tool/builtin/vfs-tools.ts
isMutatingFileToolName | isMutatingVfsToolName      domain/tool/builtin/vfs-tools.ts
```
- 你要查：每对是同一个值 export 了两个名字（alias），还是真的导出了两个不同的东西？
- 如果是 alias，判断两个名字是否都还有必要存在

## 逐条核实清单（apps，排误判后）

### desktop renderer 真实死代码嫌疑（~24 个，排除 test 后）

重点核实这些（knip 报 unused，且不是误判）：

**hooks（7 个）**：
- `useAgentRunLifecycle`、`useAgentStream`、`useAgentStreamMetrics`——agent stream 相关，疑似被新 hook 替代
- `useAutoResizeTextarea`、`useChatMessagesScrollFollow`、`useDesktopAgentActive`、`useStreamTailGenerating`

**utils（6 个）**：
- `format-token-count`、`format-user-error`、`ime-composition`、`settings-feedback`、`textarea-enter-shortcuts`、`vfs-path`

**components/ui（4 个）**：
- `IconButton`、`PickerModal`、`Switch`、`TextArea`——基础 UI 组件，可能是设计系统迁移后的遗留

**features（3 个）**：
- `chat-messages-scroll`、`tool-turn-actions`、`transcript-selectable-role`、`useWorkspaceTree`

**其他（4 个）**：
- `AppMenuBar`、`sanitize-annotate-preview-html`、`regex-test.service`

对应 Iteration：`desktop-ux-bug-fixes`、`desktop-workspace-ux-fixes`、`desktop-ui-polish`、`chat-send-render-refactor`、`agent-chat-ux-bugfix`

### mobile 真实死代码嫌疑（~9 个，排除 webview/e2e 后）

- `components/batch/ListBatchBar`、`components/form/FormErrorCard`、`components/chat/transcript-selectable-role`
- `hooks/useStreamTailGenerating`
- `navigation/linking`
- `components/rich-content/build-rich-content-styles`

对应 Iteration：`mobile-fix-v2`、`mobile-fix`、`mobile-chat-stability-fixes`

### 依赖核实

**Unused dependencies（10 个）**——逐个核实是否真的没用到：
- `rehype-raw`、`sanitize-html`（desktop）——对应 `chat-rich-render`，可能被替代
- `react-native-reanimated`、`react-native-worklets`（根 package.json）——是否是 override 残留？
- `js-tiktoken`（tokenizer-driver-rn）——对应 nmtp 迁移，是否还有用？

## 与其他角度的潜在冲突

| 对方角度 | 可能的冲突 | 你的立场 |
|----------|-----------|----------|
| **L3 架构** | 你说「这个类型该删」，L3 说「这是 documented exception 保护的」 | knip 不知道 exception——如果 L3 说它是 exception，你标「需和 L3 确认是否仍需要」 |
| **L8 API** | 你说「这个 export 没人用」，L8 说「但这是公共契约的一部分」 | 没人用的公共契约就是过度导出——你标「建议移出公共面」 |
| **L1 数据模型** | 你说「vfs zip 类型该删」，L1 可能在查 vfs zip 的 schema | 如果 schema 也在废弃，你们结论一致；如果 schema 还活着但类型死了，那是类型清理遗漏 |

## 输出格式

遵守 `CR-LOOP-GUIDE.md` 的文档结构规范。文件路径 `docs/review/phase1-lens/D1-09-dead-code.md`。

**你的报告结构特殊要求**：不要像别的角度那样写大段叙述。你的产出是一张**核实清单**——knip 报的每一条，你核实后的结论。格式：

```markdown
# D1-09：死代码 & 迭代残留

## 元信息
- 数据源：knip 6.31.0（phase0/knip-raw-output.txt + D0-3-knip-scan.md）
- 核实范围：packages/core/src（全量）+ apps（排误判后）

## 结论（2-3 段叙述）
<core 死代码的整体判断 + apps 端侧的整体判断 + 最有价值的发现>

## 核实清单

### packages/core/src

#### Unused files（2 个）
| 文件 | knip 结论 | 你的核实 | 对应 Iteration | 严重度 | 建议 |
|------|----------|---------|---------------|--------|------|
| resolve-current-workspace-snapshot.ts | unused | ✅ 确认无人引用，逻辑已被 X 内联 | chat-send-render-refactor | A | 可删 |
| resolve-flush-baseline-tree.ts | unused | ❌ 被 Y 动态调用，knip 误判 | — | — | 保留 |

#### Unused exports（按主题）
<同上表格格式>

#### Duplicate exports（3 个）
<同上>

### apps/desktop/renderer（排误判后）
<同上>

### apps/mobile/src（排误判后）
<同上>

### 依赖（10 unused deps + 19 unused devDeps）
| 依赖 | 位置 | knip 结论 | 你的核实 | 建议 |
<同上>

## knip 误判汇总（供用户参考）
<列出所有误判类别和原因，建议用户修正 knip 配置>

## 与 L3/L8 的交叉点
<哪些发现需要和 L3/L8 确认>
```

## 严重度参考

| 级别 | 场景 |
|------|------|
| **S** | 无（死代码本身不是 S 级风险，除非掩盖了安全问题） |
| **A** | core 里的死代码（影响所有端）；明确的迭代残留（有 Iteration 对应）；duplicate exports |
| **B** | apps 端侧死代码；unused dependencies；unused devDependencies |
| **C** | knip 误判；需进一步确认的嫌疑 |

## 工作量预估

- **packages/core/src**：~30 分钟（2 files + ~23 exports + 3 duplicates，逐条核实）
- **apps（排误判）**：~1 小时（~33 files + 10 deps + 19 devDeps）
- **总计**：你应该是 9 个角度里最快完成的一个
